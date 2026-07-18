import { describe, expect, test } from "bun:test";
import { ReattachedEnvironmentImpl } from "./reattached-environment";

function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3500): Promise<void> {
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
    }, 20);
  });
}

describe("ReattachedEnvironmentImpl", () => {
  test("isRunning reflects a real external process's liveness", async () => {
    const proc = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
    const impl = new ReattachedEnvironmentImpl(proc.pid);
    expect(await impl.isRunning()).toBe(true);
    proc.kill("SIGKILL");
    await proc.exited;
    expect(await impl.isRunning()).toBe(false);
  });

  test("kill sends SIGKILL to the real pid", async () => {
    const proc = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
    const impl = new ReattachedEnvironmentImpl(proc.pid);
    await impl.kill();
    await proc.exited;
    expect(await impl.isRunning()).toBe(false);
  });

  test("getStats returns real numbers for a running process and zeros after it exits", async () => {
    const proc = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
    const impl = new ReattachedEnvironmentImpl(proc.pid);
    const stats = await impl.getStats();
    expect(stats.memory).toBeGreaterThan(0);
    proc.kill("SIGKILL");
    await proc.exited;
    const statsAfter = await impl.getStats();
    expect(statsAfter).toEqual({ cpu: 0, memory: 0 });
  });

  test("sendCommand always throws (no console access for a reattached process)", async () => {
    const proc = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
    const impl = new ReattachedEnvironmentImpl(proc.pid);
    await expect(impl.sendCommand("say hi")).rejects.toThrow(/console is unavailable/);
    proc.kill("SIGKILL");
    await proc.exited;
  });

  test("executeAsync always throws (a reattached environment never spawns)", async () => {
    const proc = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
    const impl = new ReattachedEnvironmentImpl(proc.pid);
    await expect(impl.executeAsync({ command: "sleep 5", cwd: "." })).rejects.toThrow();
    proc.kill("SIGKILL");
    await proc.exited;
  });

  test(
    "onExit fires once the polled process is observed dead",
    async () => {
      const proc = Bun.spawn(["sleep", "1"], { stdout: "ignore", stderr: "ignore" });
      const impl = new ReattachedEnvironmentImpl(proc.pid);
      let exited = false;
      impl.onExit(() => {
        exited = true;
      });
      await proc.exited;
      await waitFor(() => exited, 3500);
      expect(exited).toBe(true);
    },
    5000,
  );
});
