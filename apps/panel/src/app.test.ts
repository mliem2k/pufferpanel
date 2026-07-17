import { describe, expect, test } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import type { PanelDb } from "@pufferpanel/models/db";
import { createTestDb } from "@pufferpanel/models/migrate-test-helper";
import { createUser } from "@pufferpanel/services/user";
import { SCOPES } from "@pufferpanel/scopes";
import { createPanelApp } from "./app";
import { createAuthPlugin } from "./auth-plugin";

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

// A minimal scope-protected route used only to exercise the auth macro
// in isolation, the same way an upcoming `createXRoutes(authPlugin)` would.
function createProtectedTestApp(db: PanelDb, cookieSecret: string) {
  const authPlugin = createAuthPlugin(db, cookieSecret);
  return new Elysia().use(authPlugin).get("/protected", ({ actor }) => ({ userId: actor.userId }), {
    scope: SCOPES.ADMIN,
  });
}

describe("scope-protected routes", () => {
  test("rejects a hand-crafted, unsigned session cookie instead of treating it as authenticated", async () => {
    const db = createTestDb();
    const app = createProtectedTestApp(db, "test-cookie-secret");

    // No login ever happened, and this attacker doesn't know the cookie
    // secret. This is a syntactically-plausible but forged/invalid JWT.
    const response = await app.handle(
      new Request("http://localhost/protected", {
        headers: { cookie: "puffer_auth=eyJhbGciOiJIUzI1NiJ9.fake.fake" },
      }),
    );

    expect(response.status).toBe(401);
  });

  test("rejects a hand-crafted unsigned JSON payload masquerading as a session", async () => {
    const db = createTestDb();
    const app = createProtectedTestApp(db, "test-cookie-secret");

    // This is the exact bypass payload from the vulnerability report: valid
    // JSON, no signature at all. It must not be treated as authenticated.
    const response = await app.handle(
      new Request("http://localhost/protected", {
        headers: { cookie: `puffer_auth=${encodeURIComponent(JSON.stringify({ userId: 1 }))}` },
      }),
    );

    expect(response.status).toBe(401);
  });
});
