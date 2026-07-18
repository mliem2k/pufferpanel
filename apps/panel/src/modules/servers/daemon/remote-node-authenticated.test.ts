import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { generateNodeKeyPair } from "../../auth/node-token";
import { createNodeAuthPlugin } from "../../auth/node-auth-plugin";
import { ServerRegistry } from "./registry";
import { createNodeApp } from "./node-app";
import { createRemoteNodeClient } from "./remote-node-client";
import { NodeClientHttpError } from "./node-client";

describe("remote node client against an authenticated Node app", () => {
  test("the real Panel-signed JWT is accepted by the real node's auth plugin, over real HTTP", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-remote-integration-"));
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
    const { publicKeyJwk, privateKeyPem } = await generateNodeKeyPair();

    // This is the "node side": a real, independently-listening Elysia server
    // combining the daemon routes with the auth plugin - exactly what a
    // genuinely remote node process would run (minus a standalone deployable
    // entrypoint, out of scope for this slice).
    const remoteNodeApp = new Elysia().use(createNodeAuthPlugin(publicKeyJwk)).use(createNodeApp(registry));
    remoteNodeApp.listen(0);
    const port = (remoteNodeApp.server as { port: number }).port;

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
      await remoteNodeApp.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test("a client signing with the WRONG node's private key is rejected with a 401-mapped error", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-remote-integration-wrongkey-"));
    const registry = new ServerRegistry(dataDir);
    const { publicKeyJwk } = await generateNodeKeyPair();
    const wrongKeyPair = await generateNodeKeyPair();

    const remoteNodeApp = new Elysia().use(createNodeAuthPlugin(publicKeyJwk)).use(createNodeApp(registry));
    remoteNodeApp.listen(0);
    const port = (remoteNodeApp.server as { port: number }).port;

    try {
      const client = createRemoteNodeClient({
        publicHost: "127.0.0.1",
        publicPort: port,
        nodePrivateKeyPem: wrongKeyPair.privateKeyPem,
      });
      await expect(client.status("mliem")).rejects.toBeInstanceOf(NodeClientHttpError);
      await expect(client.status("mliem")).rejects.toMatchObject({ status: 401 });
    } finally {
      await remoteNodeApp.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
