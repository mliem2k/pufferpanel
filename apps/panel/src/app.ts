import type { PanelDb } from "@pufferpanel/models/db";
import { createAuthPlugin } from "./auth-plugin";
import { createLoginOnlyApp } from "./test-helpers";
import { createUserRoutes } from "./routes/users";
import { createNodeRoutes } from "./routes/nodes";
import { createTemplateRoutes } from "./routes/templates";
import { createServerRoutes } from "./routes/servers";
import { ServerRegistry } from "./daemon/registry";
import { createNodeApp } from "./daemon/app";
import { createLocalNodeClient } from "./daemon/node-client-local";

export function createPanelApp(db: PanelDb, cookieSecret: string, dataDir = "./data") {
  const authPlugin = createAuthPlugin(db, cookieSecret);
  const registry = new ServerRegistry(dataDir);
  const nodeApp = createNodeApp(registry);
  const localClient = createLocalNodeClient(nodeApp);
  return createLoginOnlyApp(authPlugin)
    .use(createUserRoutes(authPlugin))
    .use(createNodeRoutes(authPlugin))
    .use(createTemplateRoutes(authPlugin))
    .use(createServerRoutes(authPlugin, () => localClient));
}

export type PanelApp = ReturnType<typeof createPanelApp>;
