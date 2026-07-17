import type { PanelDb } from "../../db/client";
import { clients } from "../../db/schema";
import { eq } from "drizzle-orm";

// Pre-computed dummy hash for timing side-channel protection
const DUMMY_HASH_FOR_TIMING_SAFETY = await Bun.password.hash("dummy-password-for-timing-safety", {
  algorithm: "bcrypt",
  cost: 10,
});

export interface CreateClientInput {
  userId: number;
  name: string;
  description?: string;
  serverId?: string;
}

export interface CreatedClient {
  clientId: string;
  clientSecret: string;
}

export async function createClient(
  db: PanelDb,
  input: CreateClientInput,
): Promise<CreatedClient> {
  const clientId = `pfp_${crypto.randomUUID()}`;
  const clientSecret = crypto.randomUUID() + crypto.randomUUID();
  const hashedClientSecret = await Bun.password.hash(clientSecret, {
    algorithm: "bcrypt",
    cost: 10,
  });
  await db.insert(clients).values({
    clientId,
    hashedClientSecret,
    userId: input.userId,
    serverId: input.serverId ?? null,
    name: input.name,
    description: input.description ?? null,
  });
  return { clientId, clientSecret };
}

export async function listClients(db: PanelDb) {
  return db
    .select({
      id: clients.id,
      clientId: clients.clientId,
      userId: clients.userId,
      serverId: clients.serverId,
      name: clients.name,
      description: clients.description,
    })
    .from(clients);
}

export async function deleteClient(db: PanelDb, id: number) {
  await db.delete(clients).where(eq(clients.id, id));
}

export async function verifyClientCredentials(
  db: PanelDb,
  clientId: string,
  clientSecret: string,
) {
  const [row] = await db.select().from(clients).where(eq(clients.clientId, clientId));
  const hashToCheck = row?.hashedClientSecret ?? DUMMY_HASH_FOR_TIMING_SAFETY;
  const valid = await Bun.password.verify(clientSecret, hashToCheck);
  if (!row || !valid) return null;
  const { hashedClientSecret, ...safeRow } = row;
  return safeRow;
}
