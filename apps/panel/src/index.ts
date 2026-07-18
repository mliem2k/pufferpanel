import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { loadConfig, resolveCookieSecret, type PanelConfig } from "./config";
import { bootstrapAdmin } from "./bootstrap-admin";
import { backfillNodeKeys, ensureLocalNode } from "./modules/nodes/service";
import { createPanelApp } from "./app";

export async function bootstrap(config: PanelConfig) {
  await mkdir(config.dataDir, { recursive: true });
  await mkdir(dirname(config.dbPath), { recursive: true });
  const db = createDb(config.dbPath);
  runMigrations(db);
  await backfillNodeKeys(db);
  const cookieSecret = await resolveCookieSecret(config.dataDir, config.cookieSecret);
  await bootstrapAdmin(db, config.initialAdmin);
  await ensureLocalNode(db);
  return createPanelApp(db, cookieSecret, config.dataDir);
}

if (import.meta.main) {
  const config = loadConfig();
  const app = await bootstrap(config);
  app.listen({ port: config.port, hostname: config.host });
  console.log(`panel listening on ${config.host}:${config.port}`);

  const shutdown = async () => {
    console.log("shutting down (game servers keep running)");
    await app.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
