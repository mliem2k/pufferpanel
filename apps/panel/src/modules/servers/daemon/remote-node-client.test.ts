import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateNodeKeyPair } from "../../auth/node-token";
import { NodeClientHttpError } from "./node-client";
import { ServerRegistry } from "./registry";
import { createNodeApp } from "./node-app";
import { createRemoteNodeClient } from "./remote-node-client";

describe("createRemoteNodeClient", () => {
  test("start, status, and stop reach a real Node app over real HTTP", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-remoteclient-"));
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
    nodeApp.listen(0);
    const port = (nodeApp.server as { port: number }).port;
    const { privateKeyPem } = await generateNodeKeyPair();

    try {
      const client = createRemoteNodeClient({
        publicHost: "127.0.0.1",
        publicPort: port,
        nodePrivateKeyPem: privateKeyPem,
      });

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
    } finally {
      await nodeApp.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test("start on an unregistered server throws a NodeClientHttpError with status 404", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-remoteclient-"));
    const registry = new ServerRegistry(dataDir);
    const nodeApp = createNodeApp(registry);
    nodeApp.listen(0);
    const port = (nodeApp.server as { port: number }).port;
    const { privateKeyPem } = await generateNodeKeyPair();

    try {
      const client = createRemoteNodeClient({
        publicHost: "127.0.0.1",
        publicPort: port,
        nodePrivateKeyPem: privateKeyPem,
      });
      await expect(client.start("missing")).rejects.toBeInstanceOf(NodeClientHttpError);
      await expect(client.start("missing")).rejects.toMatchObject({ status: 404 });
    } finally {
      await nodeApp.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
