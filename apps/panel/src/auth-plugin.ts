import { Elysia, status } from "elysia";
import type { PanelDb } from "@pufferpanel/models/db";
import { hasScope, type Actor } from "@pufferpanel/services/permission";
import type { Scope } from "@pufferpanel/scopes";

export function createAuthPlugin(db: PanelDb, cookieSecret: string) {
  return new Elysia({
    name: "auth-plugin",
    cookie: {
      secrets: cookieSecret,
      sign: ["puffer_auth"],
    },
  })
    .decorate("db", db)
    .macro({
      scope: (required: Scope) => ({
        resolve: async ({ db, cookie, params }) => {
          const session = cookie.puffer_auth?.value as { userId: number } | undefined;
          if (!session?.userId) return status(401, { error: "unauthenticated" });
          const serverIdentifier = required.forServer
            ? (params as Record<string, string | undefined>).identifier
            : undefined;
          const actor: Actor = { userId: session.userId };
          const allowed = await hasScope(db, actor, required, serverIdentifier);
          if (!allowed) return status(403, { error: "forbidden" });
          return { actor };
        },
      }),
    });
}

export type AuthPlugin = ReturnType<typeof createAuthPlugin>;
