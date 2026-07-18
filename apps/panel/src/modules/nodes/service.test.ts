import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../db/test-helper";
import { servers, nodes } from "../../db/schema";
import {
  createNode,
  listNodes,
  getNode,
  getNodeCredentials,
  ensureLocalNode,
  deleteNode,
  backfillNodeKeys,
} from "./service";

describe("node service", () => {
  test("createNode generates and returns a real keypair once", async () => {
    const db = createTestDb();
    const node = await createNode(db, {
      name: "ubuntu-mliem",
      publicHost: "panel.mliem.com",
      privateHost: "127.0.0.1",
    });
    expect(node?.nodePrivateKeyPem).toBeTruthy();
    expect(node?.nodePrivateKeyPem).toContain("PRIVATE KEY");
    expect(node?.nodePublicKeyJwk).toBeTruthy();
    expect(() => JSON.parse(node!.nodePublicKeyJwk)).not.toThrow();
  });

  test("listNodes and getNode omit the private key material", async () => {
    const db = createTestDb();
    await createNode(db, {
      name: "ubuntu-mliem",
      publicHost: "panel.mliem.com",
      privateHost: "127.0.0.1",
    });
    const list = await listNodes(db);
    expect(list[0]).not.toHaveProperty("nodePrivateKeyPem");
    expect(list[0]).not.toHaveProperty("nodePublicKeyJwk");
    const fetched = await getNode(db, list[0]!.id);
    expect(fetched).not.toHaveProperty("nodePrivateKeyPem");
    expect(fetched).not.toHaveProperty("nodePublicKeyJwk");
  });

  test("getNodeCredentials returns the private key for internal use", async () => {
    const db = createTestDb();
    const created = await createNode(db, {
      name: "ubuntu-mliem",
      publicHost: "panel.mliem.com",
      privateHost: "127.0.0.1",
      publicPort: 9090,
    });
    const creds = await getNodeCredentials(db, created!.id);
    expect(creds?.publicHost).toBe("panel.mliem.com");
    expect(creds?.publicPort).toBe(9090);
    expect(creds?.nodePrivateKeyPem).toBe(created!.nodePrivateKeyPem);
  });

  test("deleteNode removes the row", async () => {
    const db = createTestDb();
    const created = await createNode(db, {
      name: "ubuntu-mliem",
      publicHost: "panel.mliem.com",
      privateHost: "127.0.0.1",
    });
    await deleteNode(db, created!.id);
    expect(await listNodes(db)).toHaveLength(0);
  });

  test("ensureLocalNode seeds a real node row with id 0, idempotently", async () => {
    const db = createTestDb();
    await ensureLocalNode(db);
    const local = await getNodeCredentials(db, 0);
    expect(local?.id).toBe(0);
    expect(local?.nodePrivateKeyPem).toBeTruthy();

    // Calling it again must not fail (unique name constraint) or generate a
    // second keypair - it's a no-op once the row exists.
    await ensureLocalNode(db);
    const stillLocal = await getNodeCredentials(db, 0);
    expect(stillLocal?.nodePrivateKeyPem).toBe(local?.nodePrivateKeyPem);

    // A real server can now legally reference nodeId 0 without violating
    // the servers.nodeId foreign key.
    const now = new Date();
    await db.insert(servers).values({
      identifier: "mliem",
      name: "mliem",
      nodeId: 0,
      ip: "0.0.0.0",
      port: 25565,
      type: "minecraft-purpur",
      createdAt: now,
      updatedAt: now,
    });
    const rows = await db.select().from(servers);
    expect(rows[0]?.nodeId).toBe(0);
  });

  test("backfillNodeKeys generates real key material for a row with the placeholder default", async () => {
    const db = createTestDb();
    const now = new Date();
    const [row] = await db
      .insert(nodes)
      .values({
        name: "legacy-node",
        publicHost: "panel.mliem.com",
        privateHost: "127.0.0.1",
        nodePrivateKeyPem: "",
        nodePublicKeyJwk: "",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await backfillNodeKeys(db);

    const backfilled = await getNodeCredentials(db, row!.id);
    expect(backfilled?.nodePrivateKeyPem).toBeTruthy();
    expect(backfilled?.nodePrivateKeyPem).toContain("PRIVATE KEY");

    const [full] = await db.select().from(nodes).where(eq(nodes.id, row!.id));
    expect(full?.nodePublicKeyJwk).toBeTruthy();
    expect(() => JSON.parse(full!.nodePublicKeyJwk)).not.toThrow();
  });

  test("backfillNodeKeys is a no-op for a row that already has real keys", async () => {
    const db = createTestDb();
    const created = await createNode(db, {
      name: "ubuntu-mliem",
      publicHost: "panel.mliem.com",
      privateHost: "127.0.0.1",
    });

    await backfillNodeKeys(db);

    const after = await getNodeCredentials(db, created!.id);
    expect(after?.nodePrivateKeyPem).toBe(created!.nodePrivateKeyPem);
  });
});
