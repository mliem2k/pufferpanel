import type { PanelDb } from "../../db/client";
import { servers } from "../../db/schema";
import { eq } from "drizzle-orm";

export interface CreateServerInput {
  identifier: string;
  name: string;
  nodeId: number;
  ip: string;
  port: number;
  type: string;
  icon?: string;
}

export async function createServer(db: PanelDb, input: CreateServerInput) {
  const now = new Date();
  const [row] = await db
    .insert(servers)
    .values({ ...input, icon: input.icon ?? null, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

export async function listServers(db: PanelDb) {
  return db.select().from(servers);
}

export async function getServerByIdentifier(db: PanelDb, identifier: string) {
  const [row] = await db.select().from(servers).where(eq(servers.identifier, identifier));
  return row;
}

export async function updateServer(
  db: PanelDb,
  identifier: string,
  patch: Partial<Pick<CreateServerInput, "name" | "ip" | "port" | "icon">>,
) {
  const [row] = await db
    .update(servers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(servers.identifier, identifier))
    .returning();
  return row;
}

export async function deleteServer(db: PanelDb, identifier: string) {
  await db.delete(servers).where(eq(servers.identifier, identifier));
}
