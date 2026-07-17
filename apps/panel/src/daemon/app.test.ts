import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treaty } from "@elysiajs/eden";
import { ServerRegistry } from "./registry";
import { createNodeApp } from "./app";

async function seedRunnableServer(dataDir: string, identifier: string, command: string): Promise<void> {
  const dir = join(dataDir, "servers", identifier);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "definition.json"),
    JSON.stringify({
      type: "test-server",
      display: "Test Server",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command },
    }),
  );
}

describe("Node app", () => {
  test("status returns 404 for a server with no definition", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-nodeapp-"));
    const registry = new ServerRegistry(dataDir);
    const api = treaty(createNodeApp(registry));
    const { error } = await api.servers({ identifier: "missing" }).status.get();
    expect(error?.status).toBe(404);
  });

  test("start, status, and stop work end to end against a real process", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-nodeapp-"));
    await seedRunnableServer(dataDir, "mliem", "sleep 5");
    const registry = new ServerRegistry(dataDir);
    const api = treaty(createNodeApp(registry));

    const started = await api.servers({ identifier: "mliem" }).start.post();
    expect(started.error).toBeNull();

    let running = false;
    for (let attempt = 0; attempt < 20 && !running; attempt++) {
      const { data } = await api.servers({ identifier: "mliem" }).status.get();
      running = data?.running === true;
      if (!running) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(running).toBe(true);

    const stopped = await api.servers({ identifier: "mliem" }).stop.post();
    expect(stopped.error).toBeNull();
  });
});
