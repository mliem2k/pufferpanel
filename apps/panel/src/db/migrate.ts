import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { PanelDb } from "./client";

export function runMigrations(db: PanelDb): void {
  migrate(db, { migrationsFolder: `${import.meta.dir}/../../migrations` });
}
