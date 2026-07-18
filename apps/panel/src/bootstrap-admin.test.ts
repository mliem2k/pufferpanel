import { describe, expect, test } from "bun:test";
import { createTestDb } from "./db/test-helper";
import { bootstrapAdmin } from "./bootstrap-admin";
import { listUsers, verifyPassword } from "./modules/users/service";
import { hasScope } from "./modules/auth/permission";
import { SCOPES } from "./scopes";

describe("bootstrapAdmin", () => {
  test("does nothing when no admin config is given", async () => {
    const db = createTestDb();
    await bootstrapAdmin(db, undefined);
    expect(await listUsers(db)).toEqual([]);
  });

  test("creates an admin user with the ADMIN scope when the users table is empty", async () => {
    const db = createTestDb();
    await bootstrapAdmin(db, { username: "admin", email: "admin@example.com", password: "hunter22" });
    const users = await listUsers(db);
    expect(users).toHaveLength(1);
    expect(users[0]?.username).toBe("admin");
    const verified = await verifyPassword(db, "admin", "hunter22");
    expect(verified).not.toBeNull();
    expect(await hasScope(db, { userId: users[0]!.id }, SCOPES.ADMIN)).toBe(true);
  });

  test("does not create a second admin when a user already exists", async () => {
    const db = createTestDb();
    await bootstrapAdmin(db, { username: "first", email: "first@example.com", password: "hunter22" });
    await bootstrapAdmin(db, { username: "second", email: "second@example.com", password: "hunter22" });
    const users = await listUsers(db);
    expect(users).toHaveLength(1);
    expect(users[0]?.username).toBe("first");
  });
});
