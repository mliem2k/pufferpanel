import { describe, expect, test } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "../../db/test-helper";
import { createUser } from "../users/service";
import { createNode } from "../nodes/service";
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

  test("start returns 404 for a server with no on-disk definition", async () => {
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
    await api.servers.post(
      { identifier: "mliem", name: "mliem", nodeId: node!.id, ip: "0.0.0.0", port: 25565, type: "minecraft-purpur" },
      { headers: { cookie } },
    );

    const { error } = await api.servers({ identifier: "mliem" }).start.post(null, { headers: { cookie } });
    expect(error?.status).toBe(404);
  });
});
