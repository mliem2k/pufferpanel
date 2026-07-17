import { treaty } from "@elysiajs/eden";
import { Elysia, status, t } from "elysia";
import { verifyPassword } from "../users/service";
import { signSession, type AuthPlugin } from "./plugin";

export function createLoginOnlyApp(authPlugin: AuthPlugin) {
  return new Elysia()
    .use(authPlugin)
    .post(
      "/auth/login",
      async ({ db, sessionKey, body, cookie }) => {
        const user = await verifyPassword(db, body.username, body.password);
        if (!user) return status(401, { error: "invalid credentials" });
        cookie.puffer_auth.value = await signSession(sessionKey, user.id);
        cookie.puffer_auth.httpOnly = true;
        return { username: user.username };
      },
      {
        body: t.Object({ username: t.String(), password: t.String() }),
        cookie: t.Cookie({ puffer_auth: t.Optional(t.String()) }),
      },
    );
}

export async function loginAndGetCookie(
  authPlugin: AuthPlugin,
  username: string,
  password: string,
): Promise<string> {
  const api = treaty(createLoginOnlyApp(authPlugin));
  const { response, error } = await api.auth.login.post({ username, password });
  if (error) {
    throw new Error(`test login failed: ${JSON.stringify(error.value)}`);
  }
  return response.headers.get("set-cookie")!.split(";")[0]!;
}
