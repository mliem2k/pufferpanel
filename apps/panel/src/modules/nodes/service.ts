import type { PanelDb } from "../../db/client";
import { nodes } from "../../db/schema";
import { eq } from "drizzle-orm";
import { generateNodeKeyPair } from "../auth/node-token";

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
  const { publicKeyJwk, privateKeyPem } = await generateNodeKeyPair();
  const [row] = await db
    .insert(nodes)
    .values({
      name: input.name,
      publicHost: input.publicHost,
      privateHost: input.privateHost,
      publicPort: input.publicPort ?? 8080,
      privatePort: input.privatePort ?? 8080,
      sftpPort: input.sftpPort ?? 5657,
      nodePrivateKeyPem: privateKeyPem,
      nodePublicKeyJwk: JSON.stringify(publicKeyJwk),
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

// Internal-only accessor for constructing a remote NodeClient - returns the
// node's private key, which must never be exposed through any HTTP route.
// Unlike getNode/listNodes above (an explicit public-column allow-list), this
// is deliberately not consumed by any route handler in modules/nodes.
export async function getNodeCredentials(db: PanelDb, id: number) {
  const [row] = await db
    .select({
      id: nodes.id,
      publicHost: nodes.publicHost,
      publicPort: nodes.publicPort,
      nodePrivateKeyPem: nodes.nodePrivateKeyPem,
    })
    .from(nodes)
    .where(eq(nodes.id, id));
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

// One-time application-level backfill for rows created before this
// migration existed (or that hit the SQL migration's placeholder default,
// see 0001_steep_colossus.sql) - a schema migration can't generate real
// per-row Ed25519 keypairs, only application code can. Idempotent: rows
// that already have real key material are left untouched.
export async function backfillNodeKeys(db: PanelDb): Promise<void> {
  const rows = await db.select({ id: nodes.id, nodePrivateKeyPem: nodes.nodePrivateKeyPem }).from(nodes);
  for (const row of rows) {
    if (row.nodePrivateKeyPem !== "") continue;
    const { publicKeyJwk, privateKeyPem } = await generateNodeKeyPair();
    await db
      .update(nodes)
      .set({ nodePrivateKeyPem: privateKeyPem, nodePublicKeyJwk: JSON.stringify(publicKeyJwk), updatedAt: new Date() })
      .where(eq(nodes.id, row.id));
  }
}

// Idempotently seeds a real nodes row with an EXPLICIT id of 0 - the
// reserved "this Panel's own co-located node" sentinel used by servers.ts's
// routing logic. Needed because servers.nodeId is a NOT NULL foreign key
// (PRAGMA foreign_keys = ON in db/client.ts) - a server can never actually
// reference nodeId 0 unless a real row with that id exists first. Safe to
// call repeatedly (e.g. on every Panel boot, mirroring bootstrapAdmin's
// idempotent-seed pattern from the entrypoint feature).
export async function ensureLocalNode(db: PanelDb): Promise<void> {
  const existing = await db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, 0));
  if (existing.length > 0) return;
  const now = new Date();
  const { publicKeyJwk, privateKeyPem } = await generateNodeKeyPair();
  await db.insert(nodes).values({
    id: 0,
    name: "local",
    publicHost: "127.0.0.1",
    privateHost: "127.0.0.1",
    publicPort: 8080,
    privatePort: 8080,
    sftpPort: 5657,
    nodePrivateKeyPem: privateKeyPem,
    nodePublicKeyJwk: JSON.stringify(publicKeyJwk),
    createdAt: now,
    updatedAt: now,
  });
}
