import { describe, expect, test } from "bun:test";
import { createTestDb } from "../../db/test-helper";
import { users } from "../../db/schema";
import { createClient, verifyClientCredentials, listClients, deleteClient } from "./oauth-clients";

async function seedUser(db: ReturnType<typeof createTestDb>) {
  const now = new Date();
  const [user] = await db
    .insert(users)
    .values({
      username: "mliem",
      email: "michael.liem2k@gmail.com",
      hashedPassword: "x",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return user!;
}

describe("client service", () => {
  test("verifyClientCredentials accepts the secret returned at creation", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const created = await createClient(db, { userId: user.id, name: "join-transfer-watcher" });
    const verified = await verifyClientCredentials(db, created.clientId, created.clientSecret);
    expect(verified?.clientId).toBe(created.clientId);
  });

  test("verifyClientCredentials rejects a wrong secret", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const created = await createClient(db, { userId: user.id, name: "join-transfer-watcher" });
    expect(await verifyClientCredentials(db, created.clientId, "wrong-secret")).toBeNull();
  });

  test("deleteClient removes the row", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const created = await createClient(db, { userId: user.id, name: "join-transfer-watcher" });
    const rows = await listClients(db);
    await deleteClient(db, rows[0]!.id);
    expect(await listClients(db)).toHaveLength(0);
    expect(created.clientSecret).not.toBe("");
  });
});
