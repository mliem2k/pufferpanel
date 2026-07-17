import { describe, expect, test } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "@pufferpanel/models/migrate-test-helper";
import { createUser } from "@pufferpanel/services/user";
import { grantScopes } from "@pufferpanel/services/permission";
import { SCOPES } from "@pufferpanel/scopes";
import { createPanelApp } from "./app";

describe("composed app after Wave D integration", () => {
  test("login, then hit users, nodes, and templates through the same app", async () => {
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
    const cookie = login.response.headers.get("set-cookie")!.split(";")[0]!;
    const auth = { headers: { cookie } };

    expect((await api.users.get(auth)).data).toHaveLength(1);
    expect((await api.nodes.get(auth)).data).toHaveLength(0);
    expect((await api.templates.local.get(auth)).data).toHaveLength(0);
  });
});
