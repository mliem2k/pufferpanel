import type { PanelDb } from "@pufferpanel/models/db";
import { createAuthPlugin } from "./auth-plugin";
import { createLoginOnlyApp } from "./test-helpers";

export function createPanelApp(db: PanelDb, cookieSecret: string) {
  const authPlugin = createAuthPlugin(db, cookieSecret);
  return createLoginOnlyApp(authPlugin);
}

export type PanelApp = ReturnType<typeof createPanelApp>;
