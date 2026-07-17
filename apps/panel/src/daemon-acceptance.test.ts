import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "./db/test-helper";
import { createUser } from "./modules/users/service";
import { createNode } from "./modules/nodes/service";
import { grantScopes } from "./modules/auth/permission";
import { SCOPES } from "./scopes";
import { runInstall } from "./modules/templates/execution";
import { createPanelApp } from "./app";

describe("Phase 2 Slice 1 acceptance", () => {
  test("install a server from a definition with install steps, then start/status/stop it through the Panel API", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-phase2-acceptance-"));
    const serverDir = join(dataDir, "servers", "mliem", "files");
    const definition = {
      type: "test-server",
      display: "Test Server",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "sleep 5" },
      installation: [{ type: "command", command: "echo installed > marker.txt" }],
    };
    await mkdir(join(dataDir, "servers", "mliem"), { recursive: true });
    await writeFile(join(dataDir, "servers", "mliem", "definition.json"), JSON.stringify(definition));
    await runInstall(serverDir, definition as never, {});
    expect((await readFile(join(serverDir, "marker.txt"), "utf-8")).trim()).toBe("installed");

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
    const login = await api.auth.login.post({ username: "admin", password: "admin-pass" });
    const cookie = login.response.headers.get("set-cookie")!.split(";")[0]!;
    const auth = { headers: { cookie } };

    await api.servers.post(
      { identifier: "mliem", name: "mliem", nodeId: node!.id, ip: "0.0.0.0", port: 25565, type: "minecraft-purpur" },
      auth,
    );

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
});
