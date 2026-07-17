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
});
