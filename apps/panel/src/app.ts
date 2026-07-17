import type { PanelDb } from "./db/client";
import { createAuthPlugin } from "./modules/auth/plugin";
import { createLoginOnlyApp } from "./modules/auth/test-helpers";
import { createUserRoutes } from "./modules/users";
import { createNodeRoutes } from "./modules/nodes";
import { createTemplateRoutes } from "./modules/templates";
import { createServerRoutes } from "./modules/servers";
import { ServerRegistry } from "./modules/servers/daemon/registry";
import { createNodeApp } from "./modules/servers/daemon/node-app";
import { createLocalNodeClient } from "./modules/servers/daemon/local-node-client";

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
