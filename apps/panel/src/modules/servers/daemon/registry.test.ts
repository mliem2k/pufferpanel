import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServerRegistry } from "./registry";
import { dockerFetch, findContainer } from "./docker-client";

function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
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
    }, 25);
  });
}

async function seedDefinition(dataDir: string, identifier: string, definition: unknown): Promise<void> {
  const dir = join(dataDir, "servers", identifier);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "definition.json"), JSON.stringify(definition));
}

describe("ServerRegistry", () => {
  test("loadDefinition returns null for an identifier with no definition file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    const registry = new ServerRegistry(dataDir);
    expect(await registry.loadDefinition("missing")).toBeNull();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("loadDefinition reads and validates a real definition file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const registry = new ServerRegistry(dataDir);
    const definition = await registry.loadDefinition("mliem");
    expect(definition?.type).toBe("minecraft-purpur");
    await rm(dataDir, { recursive: true, force: true });
  });

  test("getOrCreateEnvironment returns null when no definition exists", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    const registry = new ServerRegistry(dataDir);
    expect(await registry.getOrCreateEnvironment("missing")).toBeNull();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("getOrCreateEnvironment returns the same Environment instance on repeated calls", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const registry = new ServerRegistry(dataDir);
    const first = await registry.getOrCreateEnvironment("mliem");
    const second = await registry.getOrCreateEnvironment("mliem");
    expect(first).not.toBeNull();
    expect(first).toBe(second);
    await rm(dataDir, { recursive: true, force: true });
  });

  test("loadDefinition returns null for malformed JSON instead of throwing", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    const dir = join(dataDir, "servers", "broken");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "definition.json"), "{ this is not valid json");
    const registry = new ServerRegistry(dataDir);
    expect(await registry.loadDefinition("broken")).toBeNull();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("concurrent getOrCreateEnvironment calls for the same identifier share one Environment instance", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const registry = new ServerRegistry(dataDir);
    const [first, second] = await Promise.all([
      registry.getOrCreateEnvironment("mliem"),
      registry.getOrCreateEnvironment("mliem"),
    ]);
    expect(first).not.toBeNull();
    expect(first).toBe(second);
    await rm(dataDir, { recursive: true, force: true });
  });

  test("reattaches to a live external process recorded in the pid file instead of spawning fresh", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const proc = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
    const registry = new ServerRegistry(dataDir);
    await mkdir(join(dataDir, "servers", "mliem"), { recursive: true });
    await writeFile(registry.getPidFilePath("mliem"), String(proc.pid));

    const environment = await registry.getOrCreateEnvironment("mliem");
    expect(environment?.getStatus().running).toBe(true);
    expect(await environment?.isRunning()).toBe(true);

    proc.kill("SIGKILL");
    await proc.exited;
    await rm(dataDir, { recursive: true, force: true });
  });

  test(
    "removes the pid file after a reattached environment is stopped, with no TtyEnvironmentImpl listener alive to mask a missing cleanup",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
      await seedDefinition(dataDir, "mliem", {
        type: "minecraft-purpur",
        display: "Purpur",
        environment: { type: "tty" },
        supportedEnvironments: [{ type: "tty" }],
        variables: {},
        execution: { command: "echo hi" },
      });
      // Spawned directly via Bun.spawn - never through a TtyEnvironmentImpl -
      // so there is no stray `proc.exited.then(...)` listener from a
      // pre-restart instance around to remove the pid file instead. This is
      // what makes the test an honest probe of ReattachedEnvironmentImpl's
      // own responsibility, matching a real cross-process Panel restart
      // where the original TtyEnvironmentImpl instance is truly gone.
      const proc = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
      const registry = new ServerRegistry(dataDir);
      await mkdir(join(dataDir, "servers", "mliem"), { recursive: true });
      const pidFilePath = registry.getPidFilePath("mliem");
      await writeFile(pidFilePath, String(proc.pid));

      const environment = await registry.getOrCreateEnvironment("mliem");
      expect(environment?.getStatus().running).toBe(true);
      expect(await Bun.file(pidFilePath).exists()).toBe(true);

      await environment?.stop();

      await waitFor(async () => !(await Bun.file(pidFilePath).exists()), 5000);
      expect(await Bun.file(pidFilePath).exists()).toBe(false);

      await rm(dataDir, { recursive: true, force: true });
    },
    8000,
  );

  test("falls back to a fresh TtyEnvironmentImpl and removes the stale pid file when the recorded pid is dead", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const deadProc = Bun.spawn(["true"], { stdout: "ignore", stderr: "ignore" });
    await deadProc.exited;
    const registry = new ServerRegistry(dataDir);
    await mkdir(join(dataDir, "servers", "mliem"), { recursive: true });
    const pidFilePath = registry.getPidFilePath("mliem");
    await writeFile(pidFilePath, String(deadProc.pid));

    const environment = await registry.getOrCreateEnvironment("mliem");
    expect(environment?.getStatus().running).toBe(false);
    expect(await Bun.file(pidFilePath).exists()).toBe(false);

    await rm(dataDir, { recursive: true, force: true });
  });

  test("treats pid 0 as invalid, falls back to fresh spawn, and removes the file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const registry = new ServerRegistry(dataDir);
    await mkdir(join(dataDir, "servers", "mliem"), { recursive: true });
    const pidFilePath = registry.getPidFilePath("mliem");
    await writeFile(pidFilePath, "0");

    const environment = await registry.getOrCreateEnvironment("mliem");
    expect(environment?.getStatus().running).toBe(false);
    expect(await Bun.file(pidFilePath).exists()).toBe(false);

    await rm(dataDir, { recursive: true, force: true });
  });

  test("treats non-numeric pid file content as invalid, falls back to fresh spawn, and removes the file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const registry = new ServerRegistry(dataDir);
    await mkdir(join(dataDir, "servers", "mliem"), { recursive: true });
    const pidFilePath = registry.getPidFilePath("mliem");
    await writeFile(pidFilePath, "not-a-pid");

    const environment = await registry.getOrCreateEnvironment("mliem");
    expect(environment?.getStatus().running).toBe(false);
    expect(await Bun.file(pidFilePath).exists()).toBe(false);

    await rm(dataDir, { recursive: true, force: true });
  });

  test(
    "evicts a reattached environment once it dies so the server becomes startable again instead of being stuck forever",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
      await seedDefinition(dataDir, "mliem", {
        type: "minecraft-purpur",
        display: "Purpur",
        environment: { type: "tty" },
        supportedEnvironments: [{ type: "tty" }],
        variables: {},
        execution: { command: "sleep 5" },
      });
      // Spawned directly via Bun.spawn - never through a TtyEnvironmentImpl -
      // so this genuinely exercises the ReattachedEnvironmentImpl reattach
      // path, matching a real cross-process Panel restart.
      const proc = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
      const registry = new ServerRegistry(dataDir);
      await mkdir(join(dataDir, "servers", "mliem"), { recursive: true });
      const pidFilePath = registry.getPidFilePath("mliem");
      await writeFile(pidFilePath, String(proc.pid));

      const first = await registry.getOrCreateEnvironment("mliem");
      expect(first?.getStatus().running).toBe(true);

      // Simulate a spontaneous crash: kill the process directly, not through
      // the Environment/impl, so the only way the registry learns about the
      // death is via ReattachedEnvironmentImpl's own polling -> onExit wiring.
      proc.kill("SIGKILL");
      await proc.exited;

      await waitFor(() => first?.getStatus().running === false, 5000);
      expect(first?.getStatus().running).toBe(false);

      const second = await registry.getOrCreateEnvironment("mliem");
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);

      const workDir = await mkdtemp(join(tmpdir(), "pfp-registry-work-"));
      await expect(second!.start({ command: "sleep 2", cwd: workDir })).resolves.toBeUndefined();

      await second!.kill();
      await rm(workDir, { recursive: true, force: true });
      await rm(dataDir, { recursive: true, force: true });
    },
    8000,
  );
});

describe("ServerRegistry Docker dispatch", () => {
  // Safety-net sweep: a per-test try/finally is not sufficient defense on
  // its own for a test whose real container lifecycle (create -> run ->
  // stop) can approach its declared bun:test timeout under real,
  // non-warm-cache conditions. When a test times out, Bun abandons it - the
  // test's own try/finally does NOT reliably get to run, because the
  // timeout races against (rather than cancels and awaits) the test's
  // promise chain. Track every container name these tests might create the
  // moment it's constructed, before any create/start call, so it's tracked
  // even if the test never reaches its own cleanup, and unconditionally
  // sweep them all here regardless of how each test above exited.
  const containerNamesToSweep: string[] = [];
  // Captured once, at describe-body evaluation time, before any test in this
  // block has run - this is the only value afterAll can trust, since a
  // timed-out test's own finally-based restore (see the fake-socket-server
  // test below) is not guaranteed to run.
  const originalDockerSocketEnv = process.env.PANEL_DOCKER_SOCKET;

  afterAll(async () => {
    // Reset unconditionally BEFORE sweeping, regardless of whether any
    // individual test's own env-var restore ran - a timed-out test's finally
    // block is not guaranteed to run, but afterAll is. Without this, a
    // timed-out fake-socket test would leave PANEL_DOCKER_SOCKET pointed at
    // an already-stopped fake socket, and every DELETE below would silently
    // fail against a dead socket path, defeating the sweep entirely.
    if (originalDockerSocketEnv === undefined) {
      delete process.env.PANEL_DOCKER_SOCKET;
    } else {
      process.env.PANEL_DOCKER_SOCKET = originalDockerSocketEnv;
    }
    for (const name of containerNamesToSweep) {
      await dockerFetch(`/containers/${name}?force=true`, { method: "DELETE" }).catch(() => {});
    }
  });

  test(
    "getOrCreateEnvironment spawns a real Docker container for a docker-typed definition",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-docker-"));
      const identifier = `docker-fresh-${Date.now()}`;
      await seedDefinition(dataDir, identifier, {
        type: "test-server",
        display: "Test Server",
        environment: { type: "docker", image: "alpine:latest" },
        supportedEnvironments: [{ type: "docker" }],
        variables: {},
        execution: { command: "sleep 30" },
      });
      const registry = new ServerRegistry(dataDir);
      const containerName = registry.getContainerName(identifier);
      containerNamesToSweep.push(containerName);
      try {
        const environment = await registry.getOrCreateEnvironment(identifier);
        expect(environment).not.toBeNull();
        await environment!.start({
          command: "sleep 30",
          cwd: registry.getServerDir(identifier),
          image: "alpine:latest",
        });
        await waitFor(async () => (await findContainer(containerName))?.running === true);
        expect(await environment!.isRunning()).toBe(true);
        await environment!.kill();
      } finally {
        await dockerFetch(`/containers/${containerName}?force=true`, { method: "DELETE" }).catch(() => {});
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    10000,
  );

  test(
    "getOrCreateEnvironment reattaches to an already-running container by name, on a fresh registry instance",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-docker-"));
      const identifier = `docker-reattach-${Date.now()}`;
      await seedDefinition(dataDir, identifier, {
        type: "test-server",
        display: "Test Server",
        environment: { type: "docker", image: "alpine:latest" },
        supportedEnvironments: [{ type: "docker" }],
        variables: {},
        execution: { command: "sleep 30" },
      });
      const registryBefore = new ServerRegistry(dataDir);
      const containerName = registryBefore.getContainerName(identifier);
      containerNamesToSweep.push(containerName);
      try {
        const environmentBefore = await registryBefore.getOrCreateEnvironment(identifier);
        await environmentBefore!.start({
          command: "sleep 30",
          cwd: registryBefore.getServerDir(identifier),
          image: "alpine:latest",
        });
        await waitFor(async () => (await findContainer(containerName))?.running === true);
        const idBefore = (await findContainer(containerName))!.id;

        const registryAfter = new ServerRegistry(dataDir);
        const environmentAfter = await registryAfter.getOrCreateEnvironment(identifier);
        expect(environmentAfter?.getStatus().running).toBe(true);

        const idAfter = (await findContainer(containerName))!.id;
        expect(idAfter).toBe(idBefore);

        await environmentAfter!.stop();
        await waitFor(async () => (await findContainer(containerName))?.running === false);
      } finally {
        await dockerFetch(`/containers/${containerName}?force=true`, { method: "DELETE" }).catch(() => {});
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    25000,
  );

  test(
    "getOrCreateEnvironment still resolves to a fresh Environment instead of rejecting when findContainer throws a real Docker daemon error",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-docker-fake-"));
      const fakeSocketPath = join(dataDir, "fake.sock");
      const originalEnv = process.env.PANEL_DOCKER_SOCKET;
      process.env.PANEL_DOCKER_SOCKET = fakeSocketPath;

      const server = Bun.listen({
        unix: fakeSocketPath,
        socket: {
          data(socket) {
            const responseText = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n";
            socket.write(new TextEncoder().encode(responseText));
          },
          open() {},
          close() {},
          error() {},
        },
      });

      try {
        const identifier = `docker-findcontainer-throws-${Date.now()}`;
        await seedDefinition(dataDir, identifier, {
          type: "test-server",
          display: "Test Server",
          environment: { type: "docker", image: "alpine:latest" },
          supportedEnvironments: [{ type: "docker" }],
          variables: {},
          execution: { command: "sleep 30" },
        });
        const registry = new ServerRegistry(dataDir);

        const environment = await registry.getOrCreateEnvironment(identifier);

        expect(environment).not.toBeNull();
        expect(environment?.getStatus().running).toBe(false);
      } finally {
        server.stop(true);
        // Defense-in-depth for the non-timeout case: this restore is no
        // longer the ONLY thing responsible for resetting the env var. The
        // describe block's afterAll resets it unconditionally before its
        // sweep loop, so a timeout on this test (which would skip this
        // finally) can't leave later cleanup pointed at a dead socket.
        if (originalEnv === undefined) {
          delete process.env.PANEL_DOCKER_SOCKET;
        } else {
          process.env.PANEL_DOCKER_SOCKET = originalEnv;
        }
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    10000,
  );

  test(
    "a findContainer failure is never cached: the next getOrCreateEnvironment call retries instead of being stuck with a blind environment",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-docker-nocache-"));
      const fakeSocketPath = join(dataDir, "fake.sock");
      const originalEnv = process.env.PANEL_DOCKER_SOCKET;
      const identifier = `docker-findcontainer-nocache-${Date.now()}`;
      const registry = new ServerRegistry(dataDir);
      const containerName = registry.getContainerName(identifier);
      containerNamesToSweep.push(containerName);

      const server = Bun.listen({
        unix: fakeSocketPath,
        socket: {
          data(socket) {
            const responseText = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n";
            socket.write(new TextEncoder().encode(responseText));
          },
          open() {},
          close() {},
          error() {},
        },
      });

      try {
        await seedDefinition(dataDir, identifier, {
          type: "test-server",
          display: "Test Server",
          environment: { type: "docker", image: "alpine:latest" },
          supportedEnvironments: [{ type: "docker" }],
          variables: {},
          execution: { command: "sleep 30" },
        });

        // First call: findContainer throws (fake socket always 500s). Per
        // the fix, this must NOT be cached - only that this call itself
        // still resolves to a usable (blind) environment.
        process.env.PANEL_DOCKER_SOCKET = fakeSocketPath;
        const firstAttempt = await registry.getOrCreateEnvironment(identifier);
        expect(firstAttempt).not.toBeNull();
        expect(firstAttempt?.getStatus().running).toBe(false);
        server.stop(true);

        // Point back at the real daemon and seed a genuinely running
        // container under the exact name the registry would look up.
        if (originalEnv === undefined) {
          delete process.env.PANEL_DOCKER_SOCKET;
        } else {
          process.env.PANEL_DOCKER_SOCKET = originalEnv;
        }
        const createRes = await dockerFetch(`/containers/create?name=${containerName}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            Image: "alpine:latest",
            Cmd: ["sh", "-c", "sleep 30"],
            HostConfig: { NetworkMode: "host" },
          }),
        });
        const { Id: realContainerId } = (await createRes.json()) as { Id: string };
        await dockerFetch(`/containers/${realContainerId}/start`, { method: "POST" });
        await waitFor(async () => (await findContainer(containerName))?.running === true);

        // Second call, same identifier: if the first call's failure had
        // been wrongly cached, this would return the SAME blind instance
        // (still running: false) without ever re-checking. The fix means
        // this retries the check from scratch and genuinely reattaches.
        const secondAttempt = await registry.getOrCreateEnvironment(identifier);
        expect(secondAttempt).not.toBe(firstAttempt);
        expect(secondAttempt?.getStatus().running).toBe(true);

        await secondAttempt!.kill();
      } finally {
        server.stop(true);
        if (originalEnv === undefined) {
          delete process.env.PANEL_DOCKER_SOCKET;
        } else {
          process.env.PANEL_DOCKER_SOCKET = originalEnv;
        }
        await dockerFetch(`/containers/${containerName}?force=true`, { method: "DELETE" }).catch(() => {});
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    10000,
  );
});
