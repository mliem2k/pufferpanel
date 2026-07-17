import { describe, expect, test } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import type { PanelDb } from "@pufferpanel/models/db";
import { createTestDb } from "@pufferpanel/models/migrate-test-helper";
import { createUser } from "@pufferpanel/services/user";
import { grantScopes } from "@pufferpanel/services/permission";
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

  test("accepts a genuine signed session cookie and returns the authenticated user", async () => {
    const db = createTestDb();
    const testUsername = "mliem";
    const testPassword = "correct horse";

    // Create a user
    const user = await createUser(db, {
      username: testUsername,
      email: "michael.liem2k@gmail.com",
      password: testPassword,
    });

    const userId = user?.id ?? 1; // Fallback to 1 if createUser doesn't return an object with id

    // Grant the user SCOPES.ADMIN
    await grantScopes(db, { userId }, [SCOPES.ADMIN.value]);

    // Login via the real login endpoint to get a genuine session cookie
    const loginApp = createPanelApp(db, "test-cookie-secret");
    const loginApi = treaty(loginApp);

    const { response: loginResponse } = await loginApi.auth.login.post({
      username: testUsername,
      password: testPassword,
    });

    const setCookieHeader = loginResponse.headers.get("set-cookie");
    if (!setCookieHeader) {
      throw new Error("Login did not return a session cookie");
    }

    // Extract the puffer_auth cookie value
    const cookieMatch = setCookieHeader.match(/puffer_auth=([^;]+)/);
    const cookieValue = cookieMatch?.[1];
    if (!cookieValue) {
      throw new Error("Could not extract puffer_auth value from Set-Cookie header");
    }

    // Now hit the protected endpoint with the genuine session cookie
    const protectedApp = createProtectedTestApp(db, "test-cookie-secret");
    const protectedResponse = await protectedApp.handle(
      new Request("http://localhost/protected", {
        headers: { cookie: `puffer_auth=${cookieValue}` },
      }),
    );

    expect(protectedResponse.status).toBe(200);
    const body = (await protectedResponse.json()) as { userId: number };
    expect(body.userId).toBe(userId);
    expect(typeof body.userId).toBe("number");
  });
});
