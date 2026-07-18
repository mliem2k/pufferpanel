import { describe, expect, test } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "../../db/test-helper";
import { createUser } from "../users/service";
import { grantScopes } from "../auth/permission";
import { SCOPES } from "../../scopes";
import { createAuthPlugin } from "../auth/plugin";
import { loginAndGetCookie } from "../auth/test-helpers";
import { createNodeRoutes } from "./index";

describe("/nodes routes", () => {
  test("an admin can create and list nodes without the private key leaking", async () => {
    const db = createTestDb();
    const admin = await createUser(db, {
      username: "admin",
      email: "admin@mliem.com",
      password: "admin-pass",
    });
    await grantScopes(db, { userId: admin!.id }, [SCOPES.ADMIN.value]);
    const authPlugin = createAuthPlugin(db, "test-cookie-secret");
    const api = treaty(createNodeRoutes(authPlugin));
    const cookie = await loginAndGetCookie(authPlugin, "admin", "admin-pass");

    const created = await api.nodes.post(
      { name: "ubuntu-mliem", publicHost: "panel.mliem.com", privateHost: "127.0.0.1" },
      { headers: { cookie } },
    );
    expect(created.error).toBeNull();

    const list = await api.nodes.get({ headers: { cookie } });
    expect(list.data).toHaveLength(1);
    expect(list.data?.[0]).not.toHaveProperty("nodePrivateKeyPem");
    expect(list.data?.[0]).not.toHaveProperty("nodePublicKeyJwk");
  });
});
