import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerFetch } from "./docker-client";
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
  test("executeAsync creates and starts a real container, isRunning reflects it", async () => {
    const name = uniqueName("pfp-docker-env-basic");
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
    const impl = new DockerEnvironmentImpl(name);
    const lines: string[] = [];
    impl.onConsoleLine((line) => lines.push(line));
    try {
      await impl.executeAsync({ command: "cat", cwd: "/tmp", image: "alpine:latest" });
      await impl.sendCommand("echo-me-back");
      await waitFor(() => lines.includes("echo-me-back"));
      expect(lines).toContain("echo-me-back");
    } finally {
      await impl.kill();
      await removeContainer(name);
    }
  });

  test("getStats returns real numbers for a running container", async () => {
    const name = uniqueName("pfp-docker-env-stats");
    const impl = new DockerEnvironmentImpl(name);
    try {
      await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
      const stats = await impl.getStats();
      expect(typeof stats.cpu).toBe("number");
      expect(typeof stats.memory).toBe("number");
      expect(stats.memory).toBeGreaterThan(0);
    } finally {
      await impl.kill();
      await removeContainer(name);
    }
  });

  test("the server-files directory is bind-mounted and writable from inside the container", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-docker-env-mount-"));
    const name = uniqueName("pfp-docker-env-mount");
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
      await impl.kill();
      await removeContainer(name);
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test("executeAsync can be called again on the same instance after the container exited (self-healing name reuse)", async () => {
    const name = uniqueName("pfp-docker-env-restart");
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

  test("isRunning and getStats return safe defaults before any container has been created", async () => {
    const name = uniqueName("pfp-docker-env-unstarted");
    const impl = new DockerEnvironmentImpl(name);
    try {
      expect(await impl.isRunning()).toBe(false);
      expect(await impl.getStats()).toEqual({ cpu: 0, memory: 0 });
    } finally {
      await removeContainer(name);
    }
  });
});
