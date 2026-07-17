import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "./db/test-helper";
import { createUser } from "./modules/users/service";
import { createNode } from "./modules/nodes/service";
import { grantScopes } from "./modules/auth/permission";
import { SCOPES } from "./scopes";
import { createPanelApp } from "./app";

async function loginAs(api: ReturnType<typeof treaty>, username: string, password: string) {
  const { response } = await api.auth.login.post({ username, password });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function seedRunnableServer(dataDir: string, identifier: string, command: string): Promise<void> {
  const dir = join(dataDir, "servers", identifier);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "definition.json"),
    JSON.stringify({
      type: "test-server",
      display: "Test Server",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command },
    }),
  );
}

// Boots a composed Panel API (real DB + real local daemon client) with an
// admin session already logged in and a server record created, so tests only
// need to drive start/stop/status through `api`.
//
// Deliberately no explicit return type annotation here: `ReturnType<typeof
// treaty>` (without the app's own type argument) widens `api` to a generic
// Eden client and silently drops the composed app's precise route/body
// typing, which is exactly what the rest of this codebase relies on to catch
// mistakes at the call sites below. Let TS infer the real, specific type from
// `treaty(app)` instead.
async function setupPanelApiWithServer(dataDir: string, identifier: string) {
  const db = createTestDb();
  const admin = await createUser(db, {
    username: "admin",
    email: "admin@mliem.com",
    password: "admin-pass",
  });
  await grantScopes(db, { userId: admin!.id }, [SCOPES.ADMIN.value]);
  const node = await createNode(db, {
    name: "ubuntu-mliem",
    publicHost: "panel.mliem.com",
    privateHost: "127.0.0.1",
  });

  const app = createPanelApp(db, "test-cookie-secret", dataDir);
  const api = treaty(app);
  const cookie = await loginAs(api, "admin", "admin-pass");
  const auth = { headers: { cookie } };

  await api.servers.post(
    { identifier, name: identifier, nodeId: node!.id, ip: "0.0.0.0", port: 25565, type: "minecraft-purpur" },
    auth,
  );

  return { api, auth };
}

function pgrepCount(marker: string): number {
  const result = Bun.spawnSync(["pgrep", "-f", marker]);
  const output = new TextDecoder().decode(result.stdout).trim();
  return output === "" ? 0 : output.split("\n").length;
}

describe("daemon integration through the composed app", () => {
  test("a server with a real on-disk definition can be started, polled, and stopped via the Panel API", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-app-daemon-"));
    await seedRunnableServer(dataDir, "mliem", "sleep 5");
    const { api, auth } = await setupPanelApiWithServer(dataDir, "mliem");

    const started = await api.servers({ identifier: "mliem" }).start.post(null, auth);
    expect(started.error).toBeNull();

    let running = false;
    for (let attempt = 0; attempt < 20 && !running; attempt++) {
      const { data } = await api.servers({ identifier: "mliem" }).status.get(auth);
      running = data?.running === true;
      if (!running) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(running).toBe(true);

    const stopped = await api.servers({ identifier: "mliem" }).stop.post(null, auth);
    expect(stopped.error).toBeNull();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("starting an already-running server returns 409, not 500", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-app-daemon-busy-"));
    // Use a distinctive, unlikely-to-collide sleep duration as a pgrep marker
    // so we can positively confirm cleanup left no zombie process behind.
    const marker = `sleep ${300 + Math.floor(Math.random() * 500)}`;
    await seedRunnableServer(dataDir, "mliem", marker);
    const { api, auth } = await setupPanelApiWithServer(dataDir, "mliem");

    try {
      const started = await api.servers({ identifier: "mliem" }).start.post(null, auth);
      expect(started.error).toBeNull();

      let running = false;
      for (let attempt = 0; attempt < 20 && !running; attempt++) {
        const { data } = await api.servers({ identifier: "mliem" }).status.get(auth);
        running = data?.running === true;
        if (!running) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(running).toBe(true);

      const secondStart = await api.servers({ identifier: "mliem" }).start.post(null, auth);
      expect(secondStart.error?.status).toBe(409);

      const stopped = await api.servers({ identifier: "mliem" }).stop.post(null, auth);
      expect(stopped.error).toBeNull();
    } finally {
      // Best-effort cleanup in case an assertion above failed before stop().
      if (pgrepCount(marker) > 0) {
        Bun.spawnSync(["pkill", "-f", marker]);
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
