import { describe, expect, test } from "bun:test";
import type { EnvironmentImpl, ExecutionData, ServerStats } from "./environment-impl";
import { Environment } from "./environment";

class FakeEnvironmentImpl implements EnvironmentImpl {
  running = false;
  sentCommands: string[] = [];
  sentSignals: string[] = [];
  killed = false;
  private consoleListener: ((line: string) => void) | null = null;
  private exitListener: (() => void) | null = null;

  async executeAsync(_data: ExecutionData): Promise<void> {
    this.running = true;
  }
  async kill(): Promise<void> {
    this.killed = true;
    this.running = false;
    this.exitListener?.();
  }
  async getStats(): Promise<ServerStats> {
    return { cpu: 1.5, memory: 1024 };
  }
  async sendCode(signal: string): Promise<void> {
    this.sentSignals.push(signal);
  }
  async sendCommand(command: string): Promise<void> {
    this.sentCommands.push(command);
    if (command === "stop") {
      this.running = false;
      this.exitListener?.();
    }
  }
  getUid(): number {
    return 1000;
  }
  getGid(): number {
    return 1000;
  }
  async isRunning(): Promise<boolean> {
    return this.running;
  }
  onConsoleLine(listener: (line: string) => void): void {
    this.consoleListener = listener;
  }
  onExit(listener: () => void): void {
    this.exitListener = listener;
  }
  emitLine(line: string): void {
    this.consoleListener?.(line);
  }
}

describe("Environment", () => {
  test("start sets status to running", async () => {
    const impl = new FakeEnvironmentImpl();
    const env = new Environment(impl);
    await env.start({ command: "echo hi", cwd: "." });
    expect(env.getStatus().running).toBe(true);
  });

  test("console lines from the impl are buffered and emitted", async () => {
    const impl = new FakeEnvironmentImpl();
    const env = new Environment(impl);
    const received: string[] = [];
    env.on("console", (line: string) => received.push(line));
    impl.emitLine("hello world");
    expect(env.getConsoleHistory()).toEqual(["hello world"]);
    expect(received).toEqual(["hello world"]);
  });

  test("stop sends the stopCommand and succeeds without escalating to SIGTERM", async () => {
    const impl = new FakeEnvironmentImpl();
    const env = new Environment(impl);
    await env.start({ command: "echo hi", cwd: "." });
    await env.stop({ stopCommand: "stop", gracefulTimeoutMs: 200 });
    expect(impl.sentCommands).toEqual(["stop"]);
    expect(impl.sentSignals).toEqual([]);
  });

  test("stop escalates to SIGTERM when there is no stopCommand", async () => {
    const impl = new FakeEnvironmentImpl();
    impl.sendCode = async (signal: string) => {
      impl.sentSignals.push(signal);
      impl.running = false;
    };
    const env = new Environment(impl);
    await env.start({ command: "echo hi", cwd: "." });
    await env.stop({ gracefulTimeoutMs: 200 });
    expect(impl.sentSignals).toEqual(["SIGTERM"]);
  });

  test("exit from the impl flips status to not running", async () => {
    const impl = new FakeEnvironmentImpl();
    const env = new Environment(impl);
    await env.start({ command: "echo hi", cwd: "." });
    const statuses: boolean[] = [];
    env.on("status", (status: { running: boolean }) => statuses.push(status.running));
    await impl.kill();
    expect(env.getStatus().running).toBe(false);
    expect(statuses).toContain(false);
  });

  test("pollStats emits a stat event and returns the value", async () => {
    const impl = new FakeEnvironmentImpl();
    const env = new Environment(impl);
    const stats: ServerStats[] = [];
    env.on("stat", (s: ServerStats) => stats.push(s));
    const result = await env.pollStats();
    expect(result).toEqual({ cpu: 1.5, memory: 1024 });
    expect(stats).toEqual([{ cpu: 1.5, memory: 1024 }]);
  });

  test("reattachRunning marks status as running, emits status, and starts stats polling without calling executeAsync", async () => {
    const impl = new FakeEnvironmentImpl();
    const env = new Environment(impl);
    const statuses: unknown[] = [];
    const stats: ServerStats[] = [];
    env.on("status", (status) => statuses.push(status));
    env.on("stat", (s: ServerStats) => stats.push(s));

    env.reattachRunning();

    expect(env.getStatus()).toEqual({ running: true, installing: false });
    expect(statuses).toEqual([{ running: true, installing: false }]);
    expect(impl.running).toBe(false);

    await new Promise((resolve) => {
      const interval = setInterval(() => {
        if (stats.length >= 1) {
          clearInterval(interval);
          resolve(undefined);
        }
      }, 20);
    });
    expect(stats[0]).toEqual({ cpu: 1.5, memory: 1024 });

    await env.kill();
  });

  test("start throws if the server is already running", async () => {
    const impl = new FakeEnvironmentImpl();
    const env = new Environment(impl);
    await env.start({ command: "echo hi", cwd: "." });
    await expect(env.start({ command: "echo hi", cwd: "." })).rejects.toThrow("server is already running");
  });

  test("start rejecting a second call leaves the first process reachable", async () => {
    const impl = new FakeEnvironmentImpl();
    const env = new Environment(impl);
    await env.start({ command: "echo hi", cwd: "." });
    await expect(env.start({ command: "echo hi", cwd: "." })).rejects.toThrow();
    // the impl must not have been asked to spawn a second process, and the
    // Environment must still be able to reach (and stop) the first one
    expect(await env.isRunning()).toBe(true);
    await env.stop({ stopCommand: "stop", gracefulTimeoutMs: 200 });
    expect(await env.isRunning()).toBe(false);
  });

  test("concurrent start() calls only spawn once, others reject", async () => {
    const impl = new FakeEnvironmentImpl();
    let executeCount = 0;
    const originalExecute = impl.executeAsync.bind(impl);
    impl.executeAsync = async (data: ExecutionData) => {
      executeCount++;
      // Give the race a realistic window: without the in-flight guard, both
      // concurrent callers would observe isRunning() === false during this
      // delay and both proceed to spawn.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await originalExecute(data);
    };
    const env = new Environment(impl);

    const results = await Promise.allSettled([
      env.start({ command: "echo hi", cwd: "." }),
      env.start({ command: "echo hi", cwd: "." }),
      env.start({ command: "echo hi", cwd: "." }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(executeCount).toBe(1);
    expect(env.getStatus().running).toBe(true);
  });

  test("after a concurrent burst settles, start() can be called again once stopped", async () => {
    const impl = new FakeEnvironmentImpl();
    const env = new Environment(impl);

    await Promise.allSettled([
      env.start({ command: "echo hi", cwd: "." }),
      env.start({ command: "echo hi", cwd: "." }),
    ]);
    expect(env.getStatus().running).toBe(true);

    // startInFlight must have been reset even though two calls raced, so a
    // legitimate later start (after stopping) is not permanently locked out.
    await env.stop({ stopCommand: "stop", gracefulTimeoutMs: 200 });
    await env.start({ command: "echo hi", cwd: "." });
    expect(env.getStatus().running).toBe(true);
  });

  test("console buffer caps at 500 entries and evicts oldest first", async () => {
    const impl = new FakeEnvironmentImpl();
    const env = new Environment(impl);
    for (let i = 0; i < 550; i++) {
      impl.emitLine(`line-${i}`);
    }
    const history = env.getConsoleHistory();
    expect(history).toHaveLength(500);
    expect(history[0]).toBe("line-50");
    expect(history[history.length - 1]).toBe("line-549");
  });
});
