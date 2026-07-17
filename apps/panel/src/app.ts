import type { PanelDb } from "@pufferpanel/models/db";
import { createAuthPlugin } from "./auth-plugin";
import { createLoginOnlyApp } from "./test-helpers";
import { createUserRoutes } from "./routes/users";
import { createNodeRoutes } from "./routes/nodes";
import { createTemplateRoutes } from "./routes/templates";
import { createServerRoutes } from "./routes/servers";

export function createPanelApp(db: PanelDb, cookieSecret: string) {
  const authPlugin = createAuthPlugin(db, cookieSecret);
  return createLoginOnlyApp(authPlugin)
    .use(createUserRoutes(authPlugin))
    .use(createNodeRoutes(authPlugin))
    .use(createTemplateRoutes(authPlugin))
    .use(createServerRoutes(authPlugin));
}

export type PanelApp = ReturnType<typeof createPanelApp>;
