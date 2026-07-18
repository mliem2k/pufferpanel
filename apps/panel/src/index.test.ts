import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treaty } from "@elysiajs/eden";
import { bootstrap } from "./index";
import { createDb } from "./db/client";
import { getNodeCredentials } from "./modules/nodes/service";

describe("bootstrap", () => {
  test("wires migrations, cookie secret, and initial admin into a working app", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-bootstrap-"));
    const app = await bootstrap({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(dataDir, "panel.db"),
      dataDir,
      initialAdmin: { username: "admin", email: "admin@example.com", password: "hunter22" },
    });

    const api = treaty(app);
    const { error, data } = await api.auth.login.post({ username: "admin", password: "hunter22" });
    expect(error).toBeNull();
    expect(data?.username).toBe("admin");

    const secretOnDisk = await Bun.file(join(dataDir, "cookie-secret")).text();
    expect(secretOnDisk.length).toBeGreaterThan(0);

    await rm(dataDir, { recursive: true, force: true });
  });

  test("bootstrap seeds the reserved local node (id 0)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-bootstrap-localnode-"));
    await bootstrap({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(dataDir, "panel.db"),
      dataDir,
    });
    const db = createDb(join(dataDir, "panel.db"));
    const local = await getNodeCredentials(db, 0);
    expect(local?.id).toBe(0);
    await rm(dataDir, { recursive: true, force: true });
  });
});
