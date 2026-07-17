import { describe, expect, test } from "bun:test";
import { TtyEnvironmentImpl } from "./tty";

function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (check()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error("waitFor timed out"));
      }
    }, 20);
  });
}

describe("TtyEnvironmentImpl", () => {
  test("captures stdout lines from a real spawned process", async () => {
    const impl = new TtyEnvironmentImpl();
    const lines: string[] = [];
    impl.onConsoleLine((line) => lines.push(line));
    await impl.executeAsync({ command: "echo hello-from-tty", cwd: "." });
    await waitFor(() => lines.includes("hello-from-tty"));
    expect(lines).toContain("hello-from-tty");
    await impl.kill();
  });

  test("isRunning reflects the real process lifecycle", async () => {
    const impl = new TtyEnvironmentImpl();
    await impl.executeAsync({ command: "sleep 5", cwd: "." });
    expect(await impl.isRunning()).toBe(true);
    await impl.kill();
    await waitFor(async () => !(await impl.isRunning()));
    expect(await impl.isRunning()).toBe(false);
  });

  test("onExit fires when the process is killed", async () => {
    const impl = new TtyEnvironmentImpl();
    let exited = false;
    impl.onExit(() => {
      exited = true;
    });
    await impl.executeAsync({ command: "sleep 5", cwd: "." });
    await impl.kill();
    await waitFor(() => exited);
    expect(exited).toBe(true);
  });

  test("sendCommand writes to the process's stdin", async () => {
    const impl = new TtyEnvironmentImpl();
    const lines: string[] = [];
    impl.onConsoleLine((line) => lines.push(line));
    await impl.executeAsync({ command: "cat", cwd: "." });
    await impl.sendCommand("echo-me-back");
    await waitFor(() => lines.includes("echo-me-back"));
    expect(lines).toContain("echo-me-back");
    await impl.kill();
  });

  test("getStats returns real CPU/memory numbers for a running process", async () => {
    const impl = new TtyEnvironmentImpl();
    await impl.executeAsync({ command: "sleep 5", cwd: "." });
    const stats = await impl.getStats();
    expect(typeof stats.cpu).toBe("number");
    expect(typeof stats.memory).toBe("number");
    expect(stats.memory).toBeGreaterThan(0);
    await impl.kill();
  });
});
