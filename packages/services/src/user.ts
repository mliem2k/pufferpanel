import type { PanelDb } from "@pufferpanel/models/db";
import { users } from "@pufferpanel/models/schema";
import { eq } from "drizzle-orm";

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
}

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
    .returning();
  return row;
}

export async function listUsers(db: PanelDb) {
  return db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users);
}

export async function getUserById(db: PanelDb, id: number) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
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
    .returning();
  return row;
}

export async function deleteUser(db: PanelDb, id: number) {
  await db.delete(users).where(eq(users.id, id));
}

export async function verifyPassword(db: PanelDb, username: string, password: string) {
  const user = await getUserByUsername(db, username);
  if (!user) return null;
  const valid = await Bun.password.verify(password, user.hashedPassword);
  return valid ? user : null;
}
