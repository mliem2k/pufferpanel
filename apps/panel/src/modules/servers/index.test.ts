import { describe, expect, test } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "../../db/test-helper";
import { createUser } from "../users/service";
import { createNode, ensureLocalNode } from "../nodes/service";
import { grantScopes } from "../auth/permission";
import { SCOPES } from "../../scopes";
import { createPanelApp } from "../../app";

async function loginAs(api: ReturnType<typeof treaty>, username: string, password: string) {
  const { response } = await api.auth.login.post({ username, password });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

describe("/servers routes", () => {
  test("an admin can create and list servers", async () => {
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
    const app = createPanelApp(db, "test-cookie-secret");
    const api = treaty(app);
    const cookie = await loginAs(api, "admin", "admin-pass");

    const created = await api.servers.post(
      { identifier: "mliem", name: "mliem", nodeId: node!.id, ip: "0.0.0.0", port: 25565, type: "minecraft-purpur" },
      { headers: { cookie } },
    );
    expect(created.error).toBeNull();

    const list = await api.servers.get({ headers: { cookie } });
    expect(list.data).toHaveLength(1);
  });

  test("start returns 404 for a server with no on-disk definition (local node)", async () => {
    const db = createTestDb();
    const admin = await createUser(db, {
      username: "admin",
      email: "admin@mliem.com",
      password: "admin-pass",
    });
    await grantScopes(db, { userId: admin!.id }, [SCOPES.ADMIN.value]);
    // nodeId 0 is the reserved "local, co-located node" sentinel. servers.nodeId
    // is a NOT NULL foreign key (foreign_keys=ON), so a real nodes row with
    // id 0 must exist before any server can legally reference it.
    await ensureLocalNode(db);
    const app = createPanelApp(db, "test-cookie-secret");
    const api = treaty(app);
    const cookie = await loginAs(api, "admin", "admin-pass");
    await api.servers.post(
      { identifier: "mliem", name: "mliem", nodeId: 0, ip: "0.0.0.0", port: 25565, type: "minecraft-purpur" },
      { headers: { cookie } },
    );

    const { error } = await api.servers({ identifier: "mliem" }).start.post(null, { headers: { cookie } });
    expect(error?.status).toBe(404);
  });

  test("a server on a real but unreachable remote node is routed there, not silently to the local daemon", async () => {
    const db = createTestDb();
    const admin = await createUser(db, {
      username: "admin",
      email: "admin@mliem.com",
      password: "admin-pass",
    });
    await grantScopes(db, { userId: admin!.id }, [SCOPES.ADMIN.value]);
    // A real node row, but nothing is listening at this port - proves the
    // request is genuinely routed there (and fails as a real network error),
    // rather than silently falling back to the local daemon, which would
    // instead cleanly 404 with "server definition not found" (a different,
    // misleading outcome this test must NOT observe).
    const node = await createNode(db, {
      name: "unreachable-node",
      publicHost: "127.0.0.1",
      privateHost: "127.0.0.1",
      publicPort: 1,
    });
    const app = createPanelApp(db, "test-cookie-secret");
    const api = treaty(app);
    const cookie = await loginAs(api, "admin", "admin-pass");
    await api.servers.post(
      { identifier: "mliem", name: "mliem", nodeId: node!.id, ip: "0.0.0.0", port: 25565, type: "minecraft-purpur" },
      { headers: { cookie } },
    );

    const { error } = await api.servers({ identifier: "mliem" }).start.post(null, { headers: { cookie } });
    expect(error).not.toBeNull();
    expect(error?.status).not.toBe(404);
  });
});
