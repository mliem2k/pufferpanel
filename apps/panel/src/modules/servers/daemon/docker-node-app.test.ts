import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treaty } from "@elysiajs/eden";
import { ServerRegistry } from "./registry";
import { createNodeApp } from "./node-app";
import { dockerFetch } from "./docker-client";

function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      if (await check()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error("waitFor timed out"));
      }
    }, 50);
  });
}

async function seedDockerServer(dataDir: string, identifier: string, command: string): Promise<void> {
  const dir = join(dataDir, "servers", identifier);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "definition.json"),
    JSON.stringify({
      type: "test-server",
      display: "Test Server",
      environment: { type: "docker", image: "alpine:latest" },
      supportedEnvironments: [{ type: "docker" }],
      variables: {},
      execution: { command },
    }),
  );
}

describe("Node app against a real Docker-backed server", () => {
  // Safety-net sweep: a per-test try/finally is not sufficient defense on its
  // own for a test whose real container lifecycle (create -> start -> stop,
  // with stop() alone taking ~5s against a real Docker daemon - see
  // registry.test.ts) can approach its declared bun:test timeout under real,
  // non-warm-cache conditions. When a test times out, Bun abandons it - the
  // test's own try/finally does NOT reliably get to run, because the timeout
  // races against (rather than cancels and awaits) the test's promise chain.
  // Track every container name these tests might create the moment it's
  // constructed, before any create/start call, so it's tracked even if the
  // test never reaches its own cleanup, and unconditionally sweep them all
  // here regardless of how each test above exited.
  const containerNamesToSweep: string[] = [];

  afterAll(async () => {
    for (const name of containerNamesToSweep) {
      await dockerFetch(`/containers/${name}?force=true`, { method: "DELETE" }).catch(() => {});
    }
  });

  test(
    "start, status, and stop work end to end against a real container",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "pfp-docker-nodeapp-"));
      const identifier = `docker-lifecycle-${Date.now()}`;
      await seedDockerServer(dataDir, identifier, "sleep 30");
      const registry = new ServerRegistry(dataDir);
      const api = treaty(createNodeApp(registry));
      const containerName = registry.getContainerName(identifier);
      containerNamesToSweep.push(containerName);

      try {
        const started = await api.servers({ identifier }).start.post();
        expect(started.error).toBeNull();

        await waitFor(async () => {
          const { data } = await api.servers({ identifier }).status.get();
          return data?.running === true;
        });

        const stopped = await api.servers({ identifier }).stop.post();
        expect(stopped.error).toBeNull();

        await waitFor(async () => {
          const { data } = await api.servers({ identifier }).status.get();
          return data?.running === false;
        });
      } finally {
        await dockerFetch(`/containers/${containerName}?force=true`, { method: "DELETE" }).catch(() => {});
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    15000,
  );

  test(
    "start returns 409 when the container is already running",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "pfp-docker-nodeapp-"));
      const identifier = `docker-busy-${Date.now()}`;
      await seedDockerServer(dataDir, identifier, "sleep 30");
      const registry = new ServerRegistry(dataDir);
      const api = treaty(createNodeApp(registry));
      const containerName = registry.getContainerName(identifier);
      containerNamesToSweep.push(containerName);

      try {
        const started = await api.servers({ identifier }).start.post();
        expect(started.error).toBeNull();
        await waitFor(async () => {
          const { data } = await api.servers({ identifier }).status.get();
          return data?.running === true;
        });

        const secondStart = await api.servers({ identifier }).start.post();
        expect(secondStart.error?.status).toBe(409);
      } finally {
        await api.servers({ identifier }).stop.post().catch(() => {});
        await dockerFetch(`/containers/${containerName}?force=true`, { method: "DELETE" }).catch(() => {});
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    15000,
  );
});
