import { describe, expect, test } from "bun:test";
import { createTestDb } from "@pufferpanel/models/migrate-test-helper";
import { createUser, verifyPassword, listUsers, deleteUser } from "./user";

describe("user service", () => {
  test("creates a user with a bcrypt-hashed password", async () => {
    const db = createTestDb();
    const user = await createUser(db, {
      username: "mliem",
      email: "michael.liem2k@gmail.com",
      password: "correct horse",
    });
    expect(user?.hashedPassword).not.toBe("correct horse");
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
