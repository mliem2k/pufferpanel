import { describe, expect, test } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "@pufferpanel/models/migrate-test-helper";
import { createUser } from "@pufferpanel/services/user";
import { grantScopes } from "@pufferpanel/services/permission";
import { SCOPES } from "@pufferpanel/scopes";
import { createAuthPlugin } from "../auth-plugin";
import { loginAndGetCookie } from "../test-helpers";
import { createUserRoutes } from "./users";

describe("/users routes", () => {
  test("an admin can list and create users", async () => {
    const db = createTestDb();
    const admin = await createUser(db, {
      username: "admin",
      email: "admin@mliem.com",
      password: "admin-pass",
    });
    await grantScopes(db, { userId: admin!.id }, [SCOPES.ADMIN.value]);
    const authPlugin = createAuthPlugin(db, "test-cookie-secret");
    const api = treaty(createUserRoutes(authPlugin));
    const cookie = await loginAndGetCookie(authPlugin, "admin", "admin-pass");

    const created = await api.users.post(
      { username: "second", email: "second@mliem.com", password: "second-pass" },
      { headers: { cookie } },
    );
    expect(created.error).toBeNull();

    const list = await api.users.get({ headers: { cookie } });
    expect(list.data).toHaveLength(2);
  });

  test("a user without users.view is forbidden", async () => {
    const db = createTestDb();
    await createUser(db, {
      username: "plain",
      email: "plain@mliem.com",
      password: "plain-pass",
    });
    const authPlugin = createAuthPlugin(db, "test-cookie-secret");
    const api = treaty(createUserRoutes(authPlugin));
    const cookie = await loginAndGetCookie(authPlugin, "plain", "plain-pass");

    const { error } = await api.users.get({ headers: { cookie } });
    expect(error?.status).toBe(403);
  });
});
