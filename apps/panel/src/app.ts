import type { PanelDb } from "./db/client";
import { createAuthPlugin } from "./modules/auth/plugin";
import { createLoginOnlyApp } from "./modules/auth/test-helpers";
import { createUserRoutes } from "./modules/users";
import { createNodeRoutes } from "./modules/nodes";
import { createTemplateRoutes } from "./modules/templates";
import { createServerRoutes, type ClientTarget } from "./modules/servers";
import { ServerRegistry } from "./modules/servers/daemon/registry";
import { createNodeApp } from "./modules/servers/daemon/node-app";
import { createLocalNodeClient } from "./modules/servers/daemon/local-node-client";
import { createRemoteNodeClient } from "./modules/servers/daemon/remote-node-client";
import type { NodeClient } from "./modules/servers/daemon/node-client";

export function createPanelApp(db: PanelDb, cookieSecret: string, dataDir = "./data") {
  const authPlugin = createAuthPlugin(db, cookieSecret);
  const registry = new ServerRegistry(dataDir);
  const nodeApp = createNodeApp(registry);
  const localClient = createLocalNodeClient(nodeApp);

  function createClient(target: ClientTarget): NodeClient {
    if (target.id === 0) return localClient;
    return createRemoteNodeClient({
      publicHost: target.publicHost!,
      publicPort: target.publicPort!,
      nodePrivateKeyPem: target.nodePrivateKeyPem!,
    });
  }

  return createLoginOnlyApp(authPlugin)
    .use(createUserRoutes(authPlugin))
    .use(createNodeRoutes(authPlugin))
    .use(createTemplateRoutes(authPlugin))
    .use(createServerRoutes(authPlugin, createClient));
}

export type PanelApp = ReturnType<typeof createPanelApp>;
