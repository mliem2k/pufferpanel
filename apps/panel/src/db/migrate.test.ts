import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "./client";
import { runMigrations } from "./migrate";
import { users } from "./schema";

describe("runMigrations", () => {
  test("applies migrations to a fresh on-disk database, leaving the schema queryable", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-migrate-"));
    const db = createDb(join(dataDir, "panel.db"));
    runMigrations(db);
    const rows = await db.select().from(users);
    expect(rows).toEqual([]);
    await rm(dataDir, { recursive: true, force: true });
  });
});
