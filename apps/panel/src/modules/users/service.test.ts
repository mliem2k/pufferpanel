import { describe, expect, test } from "bun:test";
import { createTestDb } from "../../db/test-helper";
import {
  createUser,
  verifyPassword,
  listUsers,
  getUserById,
  getUserByUsername,
  updateUser,
  deleteUser,
} from "./service";

describe("user service", () => {
  test("creates a user with a bcrypt-hashed password", async () => {
    const db = createTestDb();
    await createUser(db, {
      username: "mliem",
      email: "michael.liem2k@gmail.com",
      password: "correct horse",
    });
    const stored = await getUserByUsername(db, "mliem");
    expect(stored?.hashedPassword).not.toBe("correct horse");
  });

  test("createUser, getUserById, and updateUser omit hashedPassword and otpSecret", async () => {
    const db = createTestDb();
    const created = await createUser(db, {
      username: "mliem",
      email: "michael.liem2k@gmail.com",
      password: "correct horse",
    });
    expect(created).not.toHaveProperty("hashedPassword");
    expect(created).not.toHaveProperty("otpSecret");

    const fetched = await getUserById(db, created!.id);
    expect(fetched).not.toHaveProperty("hashedPassword");
    expect(fetched).not.toHaveProperty("otpSecret");

    const updated = await updateUser(db, created!.id, { email: "new@mliem.com" });
    expect(updated).not.toHaveProperty("hashedPassword");
    expect(updated).not.toHaveProperty("otpSecret");
  });

  test("verifyPassword returns the user on a correct password", async () => {
    const db = createTestDb();
    await createUser(db, {
      username: "mliem",
      email: "michael.liem2k@gmail.com",
      password: "correct horse",
    });
    const result = await verifyPassword(db, "mliem", "correct horse");
    expect(result?.username).toBe("mliem");
  });

  test("verifyPassword returns null on a wrong password", async () => {
    const db = createTestDb();
    await createUser(db, {
      username: "mliem",
      email: "michael.liem2k@gmail.com",
      password: "correct horse",
    });
    const result = await verifyPassword(db, "mliem", "wrong password");
    expect(result).toBeNull();
  });

  test("verifyPassword returns null for a nonexistent username without throwing", async () => {
    const db = createTestDb();
    const result = await verifyPassword(db, "no-such-user", "whatever");
    expect(result).toBeNull();
  });

  test("deleteUser removes the row", async () => {
    const db = createTestDb();
    const user = await createUser(db, {
      username: "mliem",
      email: "michael.liem2k@gmail.com",
      password: "correct horse",
    });
    await deleteUser(db, user!.id);
    expect(await listUsers(db)).toHaveLength(0);
  });
});
