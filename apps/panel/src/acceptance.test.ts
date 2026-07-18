import { describe, expect, test } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "./db/test-helper";
import { createUser } from "./modules/users/service";
import { ensureLocalNode } from "./modules/nodes/service";
import { grantScopes } from "./modules/auth/permission";
import { SCOPES } from "./scopes";
import { createPanelApp } from "./app";

describe("Phase 1 acceptance", () => {
  test("login, create a node, create a server, create and list a template, then hit the daemon", async () => {
    const db = createTestDb();
    const admin = await createUser(db, {
      username: "admin",
      email: "admin@mliem.com",
      password: "admin-pass",
    });
    await grantScopes(db, { userId: admin!.id }, [SCOPES.ADMIN.value]);

    const app = createPanelApp(db, "test-cookie-secret");
    const api = treaty(app);

    const login = await api.auth.login.post({ username: "admin", password: "admin-pass" });
    expect(login.error).toBeNull();
    const cookie = login.response.headers.get("set-cookie")!.split(";")[0]!;
    const auth = { headers: { cookie } };

    const node = await api.nodes.post(
      { name: "ubuntu-mliem", publicHost: "panel.mliem.com", privateHost: "127.0.0.1" },
      auth,
    );
    expect(node.error).toBeNull();

    // nodeId 0 is the reserved "local, co-located node" sentinel - the daemon
    // hit below is the real local daemon, not the just-created node above
    // (which is a genuine remote-node record and must not actually be dialed).
    await ensureLocalNode(db);
    const server = await api.servers.post(
      {
        identifier: "mliem",
        name: "mliem",
        nodeId: 0,
        ip: "0.0.0.0",
        port: 25565,
        type: "minecraft-purpur",
      },
      auth,
    );
    expect(server.error).toBeNull();

    const template = await api.templates.local.post(
      {
        name: "custom-purpur",
        definition: {
          type: "minecraft-purpur",
          display: "Custom Purpur",
          environment: { type: "tty" },
          supportedEnvironments: [{ type: "tty" }],
          variables: {},
          execution: { command: "java -jar purpur.jar" },
        },
      },
      auth,
    );
    expect(template.error).toBeNull();

    const templates = await api.templates.local.get(auth);
    expect(templates.data).toHaveLength(1);

    // No on-disk server definition was written for this test (no dataDir
    // override), so the real daemon reports 404 rather than the old Phase 1
    // "not implemented" 501 stub.
    const start = await api.servers({ identifier: "mliem" }).start.post(null, auth);
    expect(start.error?.status).toBe(404);
  });
});
