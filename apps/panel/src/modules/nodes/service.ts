import type { PanelDb } from "../../db/client";
import { nodes } from "../../db/schema";
import { eq } from "drizzle-orm";

export interface CreateNodeInput {
  name: string;
  publicHost: string;
  privateHost: string;
  publicPort?: number;
  privatePort?: number;
  sftpPort?: number;
}

const publicColumns = {
  id: nodes.id,
  name: nodes.name,
  publicHost: nodes.publicHost,
  privateHost: nodes.privateHost,
  publicPort: nodes.publicPort,
  privatePort: nodes.privatePort,
  sftpPort: nodes.sftpPort,
  createdAt: nodes.createdAt,
  updatedAt: nodes.updatedAt,
};

export async function createNode(db: PanelDb, input: CreateNodeInput) {
  const now = new Date();
  const [row] = await db
    .insert(nodes)
    .values({
      name: input.name,
      publicHost: input.publicHost,
      privateHost: input.privateHost,
      publicPort: input.publicPort ?? 8080,
      privatePort: input.privatePort ?? 8080,
      sftpPort: input.sftpPort ?? 5657,
      secret: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function listNodes(db: PanelDb) {
  return db.select(publicColumns).from(nodes);
}

export async function getNode(db: PanelDb, id: number) {
  const [row] = await db.select(publicColumns).from(nodes).where(eq(nodes.id, id));
  return row;
}

export async function updateNode(
  db: PanelDb,
  id: number,
  patch: Partial<Pick<CreateNodeInput, "publicHost" | "privateHost" | "publicPort" | "privatePort">>,
) {
  const [row] = await db
    .update(nodes)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(nodes.id, id))
    .returning(publicColumns);
  return row;
}

export async function deleteNode(db: PanelDb, id: number) {
  await db.delete(nodes).where(eq(nodes.id, id));
}
