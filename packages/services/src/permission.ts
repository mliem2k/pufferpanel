import type { PanelDb } from "@pufferpanel/models/db";
import { permissions } from "@pufferpanel/models/schema";
import { eq, and, isNull } from "drizzle-orm";
import { containsScope, type Scope } from "@pufferpanel/scopes";

export interface Actor {
  userId?: number;
  clientId?: number;
}

export async function grantScopes(
  db: PanelDb,
  actor: Actor,
  scopeValues: string[],
  serverIdentifier?: string,
) {
  const [row] = await db
    .insert(permissions)
    .values({
      userId: actor.userId ?? null,
      clientId: actor.clientId ?? null,
      serverIdentifier: serverIdentifier ?? null,
      rawScopes: scopeValues.join(","),
    })
    .returning();
  return row;
}

async function grantedScopesFor(
  db: PanelDb,
  actor: Actor,
  serverIdentifier?: string,
): Promise<string[]> {
  const ownerClause =
    actor.userId !== undefined
      ? eq(permissions.userId, actor.userId)
      : eq(permissions.clientId, actor.clientId!);
  const scopeClause = serverIdentifier
    ? eq(permissions.serverIdentifier, serverIdentifier)
    : isNull(permissions.serverIdentifier);
  const rows = await db
    .select()
    .from(permissions)
    .where(and(ownerClause, scopeClause));
  return rows.flatMap((row) => (row.rawScopes.length > 0 ? row.rawScopes.split(",") : []));
}

export async function hasScope(
  db: PanelDb,
  actor: Actor,
  scope: Scope,
  serverIdentifier?: string,
): Promise<boolean> {
  const globalScopes = await grantedScopesFor(db, actor);
  if (containsScope(globalScopes, scope, serverIdentifier)) return true;
  if (!serverIdentifier) return false;
  const serverScopes = await grantedScopesFor(db, actor, serverIdentifier);
  return containsScope(serverScopes, scope, serverIdentifier);
}
