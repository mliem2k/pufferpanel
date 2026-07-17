import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServerRegistry } from "./registry";
import { createNodeApp } from "./app";
import { createLocalNodeClient } from "./node-client-local";

describe("createLocalNodeClient", () => {
  test("start, status, and stop delegate to the Node app over an in-process request", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-localclient-"));
    const dir = join(dataDir, "servers", "mliem");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "definition.json"),
      JSON.stringify({
        type: "test-server",
        display: "Test Server",
        environment: { type: "tty" },
        supportedEnvironments: [{ type: "tty" }],
        variables: {},
        execution: { command: "sleep 5" },
      }),
    );
    const registry = new ServerRegistry(dataDir);
    const nodeApp = createNodeApp(registry);
    const client = createLocalNodeClient(nodeApp);

    const started = await client.start("mliem");
    expect(started.accepted).toBe(true);

    let running = false;
    for (let attempt = 0; attempt < 20 && !running; attempt++) {
      const result = await client.status("mliem");
      running = result.running;
      if (!running) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(running).toBe(true);

    const stopped = await client.stop("mliem");
    expect(stopped.accepted).toBe(true);
  });

  test("start on an unregistered server throws NodeClientNotImplementedError-equivalent behavior", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-localclient-"));
    const registry = new ServerRegistry(dataDir);
    const nodeApp = createNodeApp(registry);
    const client = createLocalNodeClient(nodeApp);
    await expect(client.start("missing")).rejects.toThrow();
  });
});
