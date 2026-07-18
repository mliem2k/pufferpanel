import { Elysia } from "elysia";
import { verifyPanelToken } from "./node-token";

export function createNodeAuthPlugin(publicKeyJwk: Record<string, unknown>) {
  return new Elysia({ name: "node-auth-plugin" })
    .onBeforeHandle(async ({ headers, set }) => {
      const auth = headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
      if (!token || !(await verifyPanelToken(token, publicKeyJwk))) {
        set.status = 401;
        return { error: "unauthenticated" };
      }
    })
    // Elysia's plugin encapsulation defaults lifecycle hooks to "local" scope, so without
    // .as("global") this onBeforeHandle would never run for routes added by a composing app
    // via .use() — verified empirically against elysia@1.4.29, not a guess.
    .as("global");
}
