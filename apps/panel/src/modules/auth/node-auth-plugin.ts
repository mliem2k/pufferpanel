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
    // .as("global") enables this hook to short-circuit routes added via later .use()
    // calls. Elysia defaults lifecycle hooks to "local" scope — verified empirically
    // against elysia@1.4.29. IMPORTANT: Composition order still matters. This plugin
    // must be .use()'d BEFORE the routes it protects are added to the same instance:
    // - SAFE: new Elysia().use(createNodeAuthPlugin(jwk)).use(createNodeApp(registry))
    //   (401 on unauthenticated access to createNodeApp routes)
    // - UNSAFE: createNodeApp(registry).use(createNodeAuthPlugin(jwk))
    //   (silent auth bypass — hook never applies to pre-existing routes)
    .as("global");
}
