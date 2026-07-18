import type { PanelDb } from "./db/client";
import type { InitialAdminConfig } from "./config";
import { createUser, listUsers } from "./modules/users/service";
import { grantScopes } from "./modules/auth/permission";
import { SCOPES } from "./scopes";

export async function bootstrapAdmin(db: PanelDb, admin?: InitialAdminConfig): Promise<void> {
  if (!admin) return;
  const existing = await listUsers(db);
  if (existing.length > 0) return;
  const user = await createUser(db, admin);
  await grantScopes(db, { userId: user.id }, [SCOPES.ADMIN.value]);
}
