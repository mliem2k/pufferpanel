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
});
