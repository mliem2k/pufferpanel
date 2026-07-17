import { describe, expect, test } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "../../db/test-helper";
import { createUser } from "../users/service";
import { grantScopes } from "../auth/permission";
import { SCOPES } from "../../scopes";
import { createAuthPlugin } from "../auth/plugin";
import { loginAndGetCookie } from "../auth/test-helpers";
import { createTemplateRoutes } from "./index";

describe("/templates/local routes", () => {
  test("an admin can create and list local templates", async () => {
    const db = createTestDb();
    const admin = await createUser(db, {
      username: "admin",
      email: "admin@mliem.com",
      password: "admin-pass",
    });
    await grantScopes(db, { userId: admin!.id }, [SCOPES.ADMIN.value]);
    const authPlugin = createAuthPlugin(db, "test-cookie-secret");
    const api = treaty(createTemplateRoutes(authPlugin));
    const cookie = await loginAndGetCookie(authPlugin, "admin", "admin-pass");

    const created = await api.templates.local.post(
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
      { headers: { cookie } },
    );
    expect(created.error).toBeNull();

    const list = await api.templates.local.get({ headers: { cookie } });
    expect(list.data).toHaveLength(1);
  });
});
