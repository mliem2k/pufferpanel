import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerFetch, findContainer } from "./docker-client";
import { DockerEnvironmentImpl } from "./docker-environment";

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

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// Actually removes the container (not just stops it) so test runs don't
// leak stray `Exited` containers - kill() alone only stops a container, it
// never removes it. Uses the container NAME (not id) since that's always
// known from construction time, regardless of whether the container was
// ever successfully created.
async function removeContainer(name: string): Promise<void> {
  await dockerFetch(`/containers/${name}?force=true`, { method: "DELETE" }).catch(() => {});
}

describe("DockerEnvironmentImpl", () => {
  // Safety-net sweep: a per-test try/finally is not sufficient defense on its
  // own for a test whose real container lifecycle can approach its declared
  // bun:test timeout under real, non-warm-cache conditions. When a test times
  // out, Bun abandons it - the test's own try/finally does NOT reliably get
  // to run, because the timeout races against (rather than cancels and
  // awaits) the test's promise chain. Track every container name these tests
  // might create the moment it's constructed, before any create/start call,
  // so it's tracked even if the test never reaches its own cleanup, and
  // unconditionally sweep them all here regardless of how each test above
  // exited.
  const containerNamesToSweep: string[] = [];

  afterAll(async () => {
    for (const name of containerNamesToSweep) {
      await dockerFetch(`/containers/${name}?force=true`, { method: "DELETE" }).catch(() => {});
    }
  });

  test("executeAsync creates and starts a real container, isRunning reflects it", async () => {
    const name = uniqueName("pfp-docker-env-basic");
    containerNamesToSweep.push(name);
    const impl = new DockerEnvironmentImpl(name);
    try {
      await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
      expect(await impl.isRunning()).toBe(true);
    } finally {
      await removeContainer(name);
    }
  });

  test("kill stops the container, isRunning reflects it", async () => {
    const name = uniqueName("pfp-docker-env-kill");
    containerNamesToSweep.push(name);
    const impl = new DockerEnvironmentImpl(name);
    try {
      await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
      await impl.kill();
      await waitFor(async () => !(await impl.isRunning()));
      expect(await impl.isRunning()).toBe(false);
    } finally {
      await removeContainer(name);
    }
  });

  test("onExit fires when the container is killed", async () => {
    const name = uniqueName("pfp-docker-env-exit");
    containerNamesToSweep.push(name);
    const impl = new DockerEnvironmentImpl(name);
    let exited = false;
    impl.onExit(() => {
      exited = true;
    });
    try {
      await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
      await impl.kill();
      await waitFor(() => exited);
      expect(exited).toBe(true);
    } finally {
      await removeContainer(name);
    }
  });

  test("sendCommand writes to the container's stdin, onConsoleLine reads it back", async () => {
    const name = uniqueName("pfp-docker-env-console");
    containerNamesToSweep.push(name);
    const impl = new DockerEnvironmentImpl(name);
    const lines: string[] = [];
    impl.onConsoleLine((line) => lines.push(line));
    try {
      await impl.executeAsync({ command: "cat", cwd: "/tmp", image: "alpine:latest" });
      await impl.sendCommand("echo-me-back");
      await waitFor(() => lines.includes("echo-me-back"));
      expect(lines).toContain("echo-me-back");
    } finally {
      // Removal (force=true) already kills a still-running container as
      // part of removing it, so it must run first and unconditionally -
      // if kill() were called first and threw, it would abort this finally
      // block before removal ran, leaking the container. kill() is kept
      // here only as belt-and-suspenders and must never be able to skip
      // removal.
      await removeContainer(name);
      await impl.kill().catch(() => {});
    }
  });

  test("getStats returns real numbers for a running container", async () => {
    const name = uniqueName("pfp-docker-env-stats");
    containerNamesToSweep.push(name);
    const impl = new DockerEnvironmentImpl(name);
    try {
      await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
      const stats = await impl.getStats();
      expect(typeof stats.cpu).toBe("number");
      expect(typeof stats.memory).toBe("number");
      expect(stats.memory).toBeGreaterThan(0);
    } finally {
      // See comment in the sendCommand test above: removal must run first
      // and unconditionally so a kill() failure can't skip cleanup.
      await removeContainer(name);
      await impl.kill().catch(() => {});
    }
  });

  test("the server-files directory is bind-mounted and writable from inside the container", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-docker-env-mount-"));
    const name = uniqueName("pfp-docker-env-mount");
    containerNamesToSweep.push(name);
    const impl = new DockerEnvironmentImpl(name);
    try {
      await impl.executeAsync({
        command: "sh -c \"echo from-container > /data/marker.txt; sleep 30\"",
        cwd: dataDir,
        image: "alpine:latest",
      });
      await waitFor(async () => await Bun.file(join(dataDir, "marker.txt")).exists());
      const content = await Bun.file(join(dataDir, "marker.txt")).text();
      expect(content).toBe("from-container\n");
    } finally {
      // See comment in the sendCommand test above: removal must run first
      // and unconditionally so a kill() failure can't skip cleanup.
      await removeContainer(name);
      await impl.kill().catch(() => {});
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test("executeAsync can be called again on the same instance after the container exited (self-healing name reuse)", async () => {
    const name = uniqueName("pfp-docker-env-restart");
    containerNamesToSweep.push(name);
    const impl = new DockerEnvironmentImpl(name);
    try {
      await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
      await impl.kill();
      await waitFor(async () => !(await impl.isRunning()));
      // A second executeAsync under the exact same container name must not
      // fail with a Docker name-conflict error, proving the self-healing
      // delete-before-create in executeAsync works.
      await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
      expect(await impl.isRunning()).toBe(true);
      await impl.kill();
    } finally {
      await removeContainer(name);
    }
  });

  // Sanity check for a real self-healing restart (kill -> executeAsync again
  // on the SAME instance): asserts that afterward, console output and
  // sendCommand genuinely reflect only the NEW container. NOTE: this does
  // NOT actually exercise the onData stale-connection guard in openAttach()
  // - verified empirically (mutation testing: removing that guard, or the
  // lineBuffer reset, still leaves this test passing 15/15) because a fully
  // sequential, awaited restart never produces the overlapping-connection
  // window the guard exists for (an old socket delivering trailing bytes
  // AFTER the new connection is already installed). Reproducing that
  // exact race deterministically would need an injectable attach() - out of
  // scope here. This test only guards the normal (non-racing) restart path.
  test("self-healing restart: console output and sendCommand reflect only the new container, not the old one", async () => {
    const name = uniqueName("pfp-docker-env-restart-guard");
    containerNamesToSweep.push(name);
    const impl = new DockerEnvironmentImpl(name);
    const lines: string[] = [];
    impl.onConsoleLine((line) => lines.push(line));
    try {
      await impl.executeAsync({ command: "cat", cwd: "/tmp", image: "alpine:latest" });
      await impl.sendCommand("from-old-container");
      await waitFor(() => lines.includes("from-old-container"));
      expect(lines).toContain("from-old-container");

      await impl.kill();
      await waitFor(async () => !(await impl.isRunning()));

      // Self-healing restart on the SAME instance, SAME container name -
      // this is exactly the path where a stale onData/onClose callback
      // from the OLD connection could otherwise clobber state that now
      // belongs to the NEW connection/container.
      await impl.executeAsync({ command: "cat", cwd: "/tmp", image: "alpine:latest" });
      expect(await impl.isRunning()).toBe(true);

      await impl.sendCommand("from-new-container");
      await waitFor(() => lines.includes("from-new-container"));
      expect(lines).toContain("from-new-container");

      // sendCommand after the restart reached the NEW container (confirmed
      // by the echo above), and no line was duplicated/replayed from the
      // old connection.
      expect(lines.filter((l) => l === "from-old-container")).toHaveLength(1);
      expect(lines.filter((l) => l === "from-new-container")).toHaveLength(1);

      await impl.kill();
    } finally {
      await removeContainer(name);
      await impl.kill().catch(() => {});
    }
  });

  test("isRunning and getStats return safe defaults before any container has been created", async () => {
    const name = uniqueName("pfp-docker-env-unstarted");
    containerNamesToSweep.push(name);
    const impl = new DockerEnvironmentImpl(name);
    try {
      expect(await impl.isRunning()).toBe(false);
      expect(await impl.getStats()).toEqual({ cpu: 0, memory: 0 });
    } finally {
      await removeContainer(name);
    }
  });

  test("reattachToRunning attaches to an existing running container without creating a new one", async () => {
    const name = uniqueName("pfp-docker-env-reattach");
    containerNamesToSweep.push(name);
    try {
      const starter = new DockerEnvironmentImpl(name);
      await starter.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });

      const found = await findContainer(name);
      expect(found?.running).toBe(true);

      const reattached = new DockerEnvironmentImpl(name);
      await reattached.reattachToRunning(found!.id);
      expect(await reattached.isRunning()).toBe(true);

      const lines: string[] = [];
      reattached.onConsoleLine((line) => lines.push(line));
      let exited = false;
      reattached.onExit(() => {
        exited = true;
      });

      await reattached.kill();
      await waitFor(() => exited);
      expect(exited).toBe(true);

      const stillThere = await findContainer(name);
      expect(stillThere?.running).toBe(false);
    } finally {
      await removeContainer(name);
    }
  });
});
