import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveCookieSecret } from "./config";

describe("loadConfig", () => {
  test("returns defaults when no env vars are set", () => {
    const config = loadConfig({});
    expect(config.port).toBe(8080);
    expect(config.host).toBe("0.0.0.0");
    expect(config.dbPath).toBe("./data/panel.db");
    expect(config.dataDir).toBe("./data");
    expect(config.cookieSecret).toBeUndefined();
    expect(config.initialAdmin).toBeUndefined();
  });

  test("reads overrides from env vars", () => {
    const config = loadConfig({
      PANEL_PORT: "9090",
      PANEL_HOST: "127.0.0.1",
      PANEL_DB_PATH: "/tmp/custom.db",
      PANEL_DATA_DIR: "/tmp/custom-data",
      PANEL_COOKIE_SECRET: "my-secret",
    });
    expect(config.port).toBe(9090);
    expect(config.host).toBe("127.0.0.1");
    expect(config.dbPath).toBe("/tmp/custom.db");
    expect(config.dataDir).toBe("/tmp/custom-data");
    expect(config.cookieSecret).toBe("my-secret");
  });

  test("builds initialAdmin when all three admin env vars are set", () => {
    const config = loadConfig({
      PANEL_INITIAL_ADMIN_USERNAME: "admin",
      PANEL_INITIAL_ADMIN_EMAIL: "admin@example.com",
      PANEL_INITIAL_ADMIN_PASSWORD: "hunter22",
    });
    expect(config.initialAdmin).toEqual({
      username: "admin",
      email: "admin@example.com",
      password: "hunter22",
    });
  });

  test("throws naming the missing variable(s) when only some admin env vars are set", () => {
    expect(() => loadConfig({ PANEL_INITIAL_ADMIN_USERNAME: "admin" })).toThrow(/PANEL_INITIAL_ADMIN_EMAIL/);
    expect(() =>
      loadConfig({ PANEL_INITIAL_ADMIN_USERNAME: "admin", PANEL_INITIAL_ADMIN_EMAIL: "admin@example.com" }),
    ).toThrow(/PANEL_INITIAL_ADMIN_PASSWORD/);
  });
});

describe("resolveCookieSecret", () => {
  test("generates and persists a secret on first call, reuses it on the next call", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-config-"));
    const first = await resolveCookieSecret(dataDir);
    const second = await resolveCookieSecret(dataDir);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
    const onDisk = await readFile(join(dataDir, "cookie-secret"), "utf-8");
    expect(onDisk).toBe(first);
    await rm(dataDir, { recursive: true, force: true });
  });

  test("returns the override without touching disk", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-config-"));
    const secret = await resolveCookieSecret(dataDir, "override-secret");
    expect(secret).toBe("override-secret");
    const onDisk = await readFile(join(dataDir, "cookie-secret"), "utf-8").catch(() => null);
    expect(onDisk).toBeNull();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("writes the generated secret file with owner-only (0600) permissions", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-config-"));
    await resolveCookieSecret(dataDir);
    const stats = await stat(join(dataDir, "cookie-secret"));
    expect(stats.mode & 0o777).toBe(0o600);
    await rm(dataDir, { recursive: true, force: true });
  });
});
