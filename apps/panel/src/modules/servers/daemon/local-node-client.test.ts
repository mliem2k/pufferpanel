import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeClientHttpError } from "./node-client";
import { ServerRegistry } from "./registry";
import { createNodeApp } from "./node-app";
import { createLocalNodeClient } from "./local-node-client";

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
    await rm(dataDir, { recursive: true, force: true });
  });

  test("start on an unregistered server throws a NodeClientHttpError with status 404", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-localclient-"));
    const registry = new ServerRegistry(dataDir);
    const nodeApp = createNodeApp(registry);
    const client = createLocalNodeClient(nodeApp);
    await expect(client.start("missing")).rejects.toBeInstanceOf(NodeClientHttpError);
    await expect(client.start("missing")).rejects.toMatchObject({ status: 404 });
    await rm(dataDir, { recursive: true, force: true });
  });

  test("starting an already-running server throws a NodeClientHttpError with status 409", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-localclient-busy-"));
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

    try {
      const started = await client.start("mliem");
      expect(started.accepted).toBe(true);

      let running = false;
      for (let attempt = 0; attempt < 20 && !running; attempt++) {
        const result = await client.status("mliem");
        running = result.running;
        if (!running) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(running).toBe(true);

      await expect(client.start("mliem")).rejects.toBeInstanceOf(NodeClientHttpError);
      await expect(client.start("mliem")).rejects.toMatchObject({ status: 409 });
    } finally {
      // Clean up so this test doesn't leave a zombie sleep process behind.
      await client.stop("mliem");
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
