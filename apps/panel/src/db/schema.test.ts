import { describe, expect, test } from "bun:test";
import { createTestDb } from "./test-helper";
import { users, nodes, servers } from "./schema";

describe("schema", () => {
  test("round-trips a user row", async () => {
    const db = createTestDb();
    const now = new Date();
    await db.insert(users).values({
      username: "mliem",
      email: "michael.liem2k@gmail.com",
      hashedPassword: "hash",
      createdAt: now,
      updatedAt: now,
    });
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.username).toBe("mliem");
  });

  test("a server row enforces its node foreign key", async () => {
    const db = createTestDb();
    const now = new Date();
    const [node] = await db
      .insert(nodes)
      .values({
        name: "ubuntu-mliem",
        publicHost: "panel.mliem.com",
        privateHost: "127.0.0.1",
        nodePrivateKeyPem: "test-private-key-pem",
        nodePublicKeyJwk: "{}",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await db.insert(servers).values({
      identifier: "mliem",
      name: "mliem",
      nodeId: node!.id,
      ip: "0.0.0.0",
      port: 25565,
      type: "minecraft-purpur",
      createdAt: now,
      updatedAt: now,
    });
    const rows = await db.select().from(servers);
    expect(rows[0]?.nodeId).toBe(node!.id);

    let thrown = false;
    try {
      await db.insert(servers).values({
        identifier: "orphan",
        name: "orphan",
        nodeId: 9999,
        ip: "0.0.0.0",
        port: 25566,
        type: "minecraft-purpur",
        createdAt: now,
        updatedAt: now,
      });
    } catch (e) {
      thrown = true;
    }
    expect(thrown).toBe(true);
  });

  test("migration 0001 does not crash a nodes table with pre-existing rows", async () => {
    const { Database } = await import("bun:sqlite");
    const sqlite = new Database(":memory:");

    const migration0000 = await Bun.file(`${import.meta.dir}/../../migrations/0000_organic_sleeper.sql`).text();
    for (const statement of migration0000.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) sqlite.exec(trimmed);
    }

    // Insert a row using the OLD (pre-migration-0001) schema shape, which
    // still has the `secret` column instead of the keypair columns - this
    // is exactly what a real deployed nodes table looks like before this
    // migration runs.
    sqlite.exec(
      `INSERT INTO nodes (name, public_host, private_host, secret, created_at, updated_at) VALUES ('old-node', 'host', 'host', 'old-secret', 0, 0)`,
    );

    const migration0001 = await Bun.file(`${import.meta.dir}/../../migrations/0001_steep_colossus.sql`).text();
    // This must not throw - see the DEFAULT '' placeholders in
    // 0001_steep_colossus.sql. Without them, SQLite rejects adding a
    // NOT NULL column with no default to a non-empty table.
    for (const statement of migration0001.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) sqlite.exec(trimmed);
    }

    const rows = sqlite.query("SELECT * FROM nodes").all() as Array<{
      node_private_key_pem: string;
      node_public_key_jwk: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.node_private_key_pem).toBe("");
    expect(rows[0]?.node_public_key_jwk).toBe("");
  });
});
