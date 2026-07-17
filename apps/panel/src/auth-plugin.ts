import { Elysia, status } from "elysia";
import { SignJWT, jwtVerify } from "jose";
import type { PanelDb } from "@pufferpanel/models/db";
import { hasScope, type Actor } from "@pufferpanel/services/permission";
import type { Scope } from "@pufferpanel/scopes";

// Elysia's `.use()` merges decorate/state/macro/model, but does NOT propagate
// per-instance `config.cookie` (secrets/sign) to the consuming instance
// (verified against elysia@1.4.29). Relying on that config for cookie
// signing meant any Elysia instance other than the exact one holding the
// constructor config would treat `puffer_auth` as an unsigned cookie,
// letting an attacker hand-craft `Set-Cookie: puffer_auth={"userId":1}` and
// be treated as authenticated. Instead we sign/verify the session ourselves
// with jose and carry the verification key via `.decorate()`, which does
// propagate correctly through `.use()`.
export function createAuthPlugin(db: PanelDb, cookieSecret: string) {
  const sessionKey = new TextEncoder().encode(cookieSecret);

  return new Elysia({ name: "auth-plugin" })
    .decorate("db", db)
    .decorate("sessionKey", sessionKey)
    .macro({
      scope: (required: Scope) => ({
        resolve: async ({ db, sessionKey, cookie, params }) => {
          const token = cookie.puffer_auth?.value as string | undefined;
          if (!token) return status(401, { error: "unauthenticated" });
          let userId: number;
          try {
            const { payload } = await jwtVerify(token, sessionKey, { algorithms: ["HS256"] });
            if (typeof payload.userId !== "number") {
              return status(401, { error: "unauthenticated" });
            }
            userId = payload.userId;
          } catch {
            return status(401, { error: "unauthenticated" });
          }
          const serverIdentifier = required.forServer
            ? (params as Record<string, string | undefined> | undefined)?.identifier
            : undefined;
          const actor: Actor = { userId };
          const allowed = await hasScope(db, actor, required, serverIdentifier);
          if (!allowed) return status(403, { error: "forbidden" });
          return { actor };
        },
      }),
    });
}

export type AuthPlugin = ReturnType<typeof createAuthPlugin>;

export async function signSession(sessionKey: Uint8Array, userId: number): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(sessionKey);
}
