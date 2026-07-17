import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface InitialAdminConfig {
  username: string;
  email: string;
  password: string;
}

export interface PanelConfig {
  port: number;
  host: string;
  dbPath: string;
  dataDir: string;
  cookieSecret?: string;
  initialAdmin?: InitialAdminConfig;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): PanelConfig {
  const username = env.PANEL_INITIAL_ADMIN_USERNAME;
  const email = env.PANEL_INITIAL_ADMIN_EMAIL;
  const password = env.PANEL_INITIAL_ADMIN_PASSWORD;
  const providedCount = [username, email, password].filter((value) => value !== undefined).length;
  if (providedCount !== 0 && providedCount !== 3) {
    const missing = [
      username === undefined ? "PANEL_INITIAL_ADMIN_USERNAME" : null,
      email === undefined ? "PANEL_INITIAL_ADMIN_EMAIL" : null,
      password === undefined ? "PANEL_INITIAL_ADMIN_PASSWORD" : null,
    ].filter((name): name is string => name !== null);
    throw new Error(
      `PANEL_INITIAL_ADMIN_* env vars must all be set together or not at all; missing: ${missing.join(", ")}`,
    );
  }

  return {
    port: env.PANEL_PORT ? Number(env.PANEL_PORT) : 8080,
    host: env.PANEL_HOST ?? "0.0.0.0",
    dbPath: env.PANEL_DB_PATH ?? "./data/panel.db",
    dataDir: env.PANEL_DATA_DIR ?? "./data",
    cookieSecret: env.PANEL_COOKIE_SECRET,
    initialAdmin: providedCount === 3 ? { username: username!, email: email!, password: password! } : undefined,
  };
}

export async function resolveCookieSecret(dataDir: string, override?: string): Promise<string> {
  if (override) return override;
  await mkdir(dataDir, { recursive: true });
  const secretPath = join(dataDir, "cookie-secret");
  const existing = await readFile(secretPath, "utf-8").catch(() => null);
  if (existing) return existing;
  const generated = randomBytes(32).toString("hex");
  await writeFile(secretPath, generated);
  return generated;
}
