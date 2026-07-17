import { describe, expect, test } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "@pufferpanel/models/migrate-test-helper";
import { createUser } from "@pufferpanel/services/user";
import { createPanelApp } from "./app";

describe("POST /auth/login", () => {
  test("returns the username and sets a session cookie on correct credentials", async () => {
    const db = createTestDb();
    await createUser(db, {
      username: "mliem",
      email: "michael.liem2k@gmail.com",
      password: "correct horse",
    });
    const app = createPanelApp(db, "test-cookie-secret");
    const api = treaty(app);

    const { data, error, response } = await api.auth.login.post({
      username: "mliem",
      password: "correct horse",
    });

    expect(error).toBeNull();
    expect(data?.username).toBe("mliem");
    expect(response.headers.get("set-cookie")).toContain("puffer_auth");
  });

  test("returns 401 on a wrong password", async () => {
    const db = createTestDb();
    await createUser(db, {
      username: "mliem",
      email: "michael.liem2k@gmail.com",
      password: "correct horse",
    });
    const app = createPanelApp(db, "test-cookie-secret");
    const api = treaty(app);

    const { error } = await api.auth.login.post({
      username: "mliem",
      password: "wrong",
    });

    expect(error?.status).toBe(401);
  });
});
