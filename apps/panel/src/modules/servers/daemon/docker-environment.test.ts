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

describe("DockerEnvironmentImpl", () => {
  test("executeAsync creates and starts a real container, isRunning reflects it", async () => {
    const impl = new DockerEnvironmentImpl(uniqueName("pfp-docker-env-basic"));
    try {
      await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
      expect(await impl.isRunning()).toBe(true);
    } finally {
      await impl.kill();
    }
  });

  test("kill stops the container, isRunning reflects it", async () => {
    const impl = new DockerEnvironmentImpl(uniqueName("pfp-docker-env-kill"));
    await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
    await impl.kill();
    await waitFor(async () => !(await impl.isRunning()));
    expect(await impl.isRunning()).toBe(false);
  });

  test("onExit fires when the container is killed", async () => {
    const impl = new DockerEnvironmentImpl(uniqueName("pfp-docker-env-exit"));
    let exited = false;
    impl.onExit(() => {
      exited = true;
    });
    await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
    await impl.kill();
    await waitFor(() => exited);
    expect(exited).toBe(true);
  });

  test("sendCommand writes to the container's stdin, onConsoleLine reads it back", async () => {
    const impl = new DockerEnvironmentImpl(uniqueName("pfp-docker-env-console"));
    const lines: string[] = [];
    impl.onConsoleLine((line) => lines.push(line));
    try {
      await impl.executeAsync({ command: "cat", cwd: "/tmp", image: "alpine:latest" });
      await impl.sendCommand("echo-me-back");
      await waitFor(() => lines.includes("echo-me-back"));
      expect(lines).toContain("echo-me-back");
    } finally {
      await impl.kill();
    }
  });

  test("getStats returns real numbers for a running container", async () => {
    const impl = new DockerEnvironmentImpl(uniqueName("pfp-docker-env-stats"));
    try {
      await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
      const stats = await impl.getStats();
      expect(typeof stats.cpu).toBe("number");
      expect(typeof stats.memory).toBe("number");
      expect(stats.memory).toBeGreaterThan(0);
    } finally {
      await impl.kill();
    }
  });

  test("the server-files directory is bind-mounted and writable from inside the container", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-docker-env-mount-"));
    const impl = new DockerEnvironmentImpl(uniqueName("pfp-docker-env-mount"));
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
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test("executeAsync can be called again on the same instance after the container exited (self-healing name reuse)", async () => {
    const name = uniqueName("pfp-docker-env-restart");
    const impl = new DockerEnvironmentImpl(name);
    await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
    await impl.kill();
    await waitFor(async () => !(await impl.isRunning()));
    // A second executeAsync under the exact same container name must not
    // fail with a Docker name-conflict error, proving the self-healing
    // delete-before-create in executeAsync works.
    await impl.executeAsync({ command: "sleep 30", cwd: "/tmp", image: "alpine:latest" });
    expect(await impl.isRunning()).toBe(true);
    await impl.kill();
  });

  test("isRunning and getStats return safe defaults before any container has been created", async () => {
    const impl = new DockerEnvironmentImpl(uniqueName("pfp-docker-env-unstarted"));
    expect(await impl.isRunning()).toBe(false);
    expect(await impl.getStats()).toEqual({ cpu: 0, memory: 0 });
  });
});
