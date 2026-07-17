import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

export function createDb(path: string) {
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return drizzle(sqlite, { schema });
}

export type PanelDb = ReturnType<typeof createDb>;
