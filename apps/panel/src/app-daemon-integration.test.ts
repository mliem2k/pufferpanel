import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "@pufferpanel/models/migrate-test-helper";
import { createUser } from "@pufferpanel/services/user";
import { createNode } from "@pufferpanel/services/node";
import { grantScopes } from "@pufferpanel/services/permission";
import { SCOPES } from "@pufferpanel/scopes";
import { createPanelApp } from "./app";

async function loginAs(api: ReturnType<typeof treaty>, username: string, password: string) {
  const { response } = await api.auth.login.post({ username, password });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

describe("daemon integration through the composed app", () => {
  test("a server with a real on-disk definition can be started, polled, and stopped via the Panel API", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-app-daemon-"));
    const serverDir = join(dataDir, "servers", "mliem");
    await mkdir(serverDir, { recursive: true });
    await writeFile(
      join(serverDir, "definition.json"),
      JSON.stringify({
        type: "test-server",
        display: "Test Server",
        environment: { type: "tty" },
        supportedEnvironments: [{ type: "tty" }],
        variables: {},
        execution: { command: "sleep 5" },
      }),
    );

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
  });
});
