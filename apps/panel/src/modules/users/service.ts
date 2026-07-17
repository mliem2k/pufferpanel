import type { PanelDb } from "../../db/client";
import { users } from "../../db/schema";
import { eq } from "drizzle-orm";

// Pre-computed dummy hash for timing side-channel protection
const DUMMY_HASH_FOR_TIMING_SAFETY = await Bun.password.hash("dummy-password-for-timing-safety", {
  algorithm: "bcrypt",
  cost: 10,
});

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
}

const publicColumns = {
  id: users.id,
  username: users.username,
  email: users.email,
  otpActive: users.otpActive,
  allowPasswordlessLogin: users.allowPasswordlessLogin,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export async function createUser(db: PanelDb, input: CreateUserInput) {
  const hashedPassword = await Bun.password.hash(input.password, {
    algorithm: "bcrypt",
    cost: 10,
  });
  const now = new Date();
  const [row] = await db
    .insert(users)
    .values({
      username: input.username,
      email: input.email,
      hashedPassword,
      createdAt: now,
      updatedAt: now,
    })
    .returning(publicColumns);
  return row;
}

export async function listUsers(db: PanelDb) {
  return db.select(publicColumns).from(users);
}

export async function getUserById(db: PanelDb, id: number) {
  const [row] = await db.select(publicColumns).from(users).where(eq(users.id, id));
  return row;
}

export async function getUserByUsername(db: PanelDb, username: string) {
  const [row] = await db.select().from(users).where(eq(users.username, username));
  return row;
}

export async function updateUser(db: PanelDb, id: number, patch: { email?: string }) {
  const [row] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning(publicColumns);
  return row;
}

export async function deleteUser(db: PanelDb, id: number) {
  await db.delete(users).where(eq(users.id, id));
}

export async function verifyPassword(db: PanelDb, username: string, password: string) {
  const user = await getUserByUsername(db, username);
  const hashToCheck = user?.hashedPassword ?? DUMMY_HASH_FOR_TIMING_SAFETY;
  const valid = await Bun.password.verify(password, hashToCheck);
  if (!user || !valid) return null;
  return user;
}
