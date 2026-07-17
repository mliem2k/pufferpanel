import { describe, expect, test } from "bun:test";
import { createTestDb } from "@pufferpanel/models/migrate-test-helper";
import { users, nodes, servers } from "@pufferpanel/models/schema";
import { SCOPES } from "@pufferpanel/scopes";
import { grantScopes, hasScope } from "./permission";

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

async function seedServer(db: ReturnType<typeof createTestDb>, identifier: string) {
  const now = new Date();
  const [node] = await db
    .insert(nodes)
    .values({
      name: `node-${identifier}`,
      publicHost: "localhost",
      privateHost: "127.0.0.1",
      secret: "test-secret",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const [server] = await db
    .insert(servers)
    .values({
      identifier,
      name: identifier,
      nodeId: node!.id,
      ip: "127.0.0.1",
      port: 25565,
      type: "minecraft-purpur",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return server!;
}

describe("permission service", () => {
  test("a global grant allows a non-server scope", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    await grantScopes(db, { userId: user.id }, [SCOPES.NODES_VIEW.value]);
    expect(await hasScope(db, { userId: user.id }, SCOPES.NODES_VIEW)).toBe(true);
  });

  test("a server-scoped grant does not leak to a different server", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    await seedServer(db, "mliem");
    await grantScopes(db, { userId: user.id }, [SCOPES.SERVER_START.value], "mliem");
    expect(await hasScope(db, { userId: user.id }, SCOPES.SERVER_START, "mliem")).toBe(true);
    expect(await hasScope(db, { userId: user.id }, SCOPES.SERVER_START, "other")).toBe(false);
  });

  test("no grant denies access", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    expect(await hasScope(db, { userId: user.id }, SCOPES.NODES_VIEW)).toBe(false);
  });
});
