import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treaty } from "@elysiajs/eden";
import { ServerRegistry } from "./registry";
import { createNodeApp } from "./node-app";
import { dockerFetch, findContainer } from "./docker-client";

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

describe("Docker Panel restart reattachment", () => {
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
    "a Docker-backed server started before a Panel restart is reattached by name, not respawned, and remains stoppable",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "pfp-docker-restart-"));
      const identifier = `docker-restart-${Date.now()}`;
      await seedDockerServer(dataDir, identifier, "sleep 30");

      const registryBeforeRestart = new ServerRegistry(dataDir);
      const containerName = registryBeforeRestart.getContainerName(identifier);
      containerNamesToSweep.push(containerName);
      const apiBeforeRestart = treaty(createNodeApp(registryBeforeRestart));

      try {
        const started = await apiBeforeRestart.servers({ identifier }).start.post();
        expect(started.error).toBeNull();
        await waitFor(async () => (await findContainer(containerName))?.running === true);
        const idBeforeRestart = (await findContainer(containerName))!.id;

        // Simulate the Panel process restarting: a fresh ServerRegistry
        // against the same dataDir, with no pid file or any other
        // bookkeeping shared between them - reattachment for Docker relies
        // solely on the deterministic container name.
        const registryAfterRestart = new ServerRegistry(dataDir);
        const apiAfterRestart = treaty(createNodeApp(registryAfterRestart));

        const statusAfterRestart = await apiAfterRestart.servers({ identifier }).status.get();
        expect(statusAfterRestart.data?.running).toBe(true);

        const idAfterRestart = (await findContainer(containerName))!.id;
        expect(idAfterRestart).toBe(idBeforeRestart);

        const stopped = await apiAfterRestart.servers({ identifier }).stop.post();
        expect(stopped.error).toBeNull();
        await waitFor(async () => (await findContainer(containerName))?.running === false);
      } finally {
        await dockerFetch(`/containers/${containerName}?force=true`, { method: "DELETE" }).catch(() => {});
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    20000,
  );

  test(
    "the same identifier can be started again after the reattached container is stopped (self-healing name reuse through the registry)",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "pfp-docker-restart-"));
      const identifier = `docker-restart-reuse-${Date.now()}`;
      await seedDockerServer(dataDir, identifier, "sleep 30");

      const registryBeforeRestart = new ServerRegistry(dataDir);
      const containerName = registryBeforeRestart.getContainerName(identifier);
      containerNamesToSweep.push(containerName);
      const apiBeforeRestart = treaty(createNodeApp(registryBeforeRestart));

      try {
        await apiBeforeRestart.servers({ identifier }).start.post();
        await waitFor(async () => (await findContainer(containerName))?.running === true);

        const registryAfterRestart = new ServerRegistry(dataDir);
        const apiAfterRestart = treaty(createNodeApp(registryAfterRestart));
        await waitFor(async () => (await apiAfterRestart.servers({ identifier }).status.get()).data?.running === true);

        await apiAfterRestart.servers({ identifier }).stop.post();
        await waitFor(async () => (await findContainer(containerName))?.running === false);

        // Starting again through the SAME (already-reattached) registry
        // instance must succeed - this is exactly the scenario the tty path
        // needed a cache-eviction fix for; the Docker path's self-healing
        // executeAsync (delete-before-create) should make this work with no
        // equivalent fix needed.
        const restarted = await apiAfterRestart.servers({ identifier }).start.post();
        expect(restarted.error).toBeNull();
        await waitFor(async () => (await findContainer(containerName))?.running === true);
      } finally {
        await dockerFetch(`/containers/${containerName}?force=true`, { method: "DELETE" }).catch(() => {});
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    20000,
  );
});
