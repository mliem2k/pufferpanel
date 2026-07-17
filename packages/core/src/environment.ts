import { EventEmitter } from "node:events";
import type { EnvironmentImpl, ExecutionData, ServerStats } from "./environment-impl";

const CONSOLE_BUFFER_SIZE = 500;

export interface ServerStatus {
  running: boolean;
  installing: boolean;
}

export interface StopOptions {
  stopCommand?: string;
  gracefulTimeoutMs?: number;
}

// Thrown by both busy paths in start()/doStart() below. Callers (e.g. the
// daemon HTTP routes) should check `instanceof EnvironmentBusyError` rather
// than matching on `.message`, since the message text differs between the
// "already running" and "already starting" cases and is free to change.
export class EnvironmentBusyError extends Error {}

export class Environment extends EventEmitter {
  private consoleBuffer: string[] = [];
  private status: ServerStatus = { running: false, installing: false };
  private startInFlight: Promise<void> | null = null;

  constructor(private readonly impl: EnvironmentImpl) {
    super();
    this.impl.onConsoleLine((line) => this.pushConsoleLine(line));
    this.impl.onExit(() => this.setStatus({ running: false }));
  }

  private pushConsoleLine(line: string): void {
    this.consoleBuffer.push(line);
    if (this.consoleBuffer.length > CONSOLE_BUFFER_SIZE) {
      this.consoleBuffer.shift();
    }
    this.emit("console", line);
  }

  getConsoleHistory(): string[] {
    return [...this.consoleBuffer];
  }

  private setStatus(patch: Partial<ServerStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.status);
  }

  getStatus(): ServerStatus {
    return { ...this.status };
  }

  async start(data: ExecutionData): Promise<void> {
    // The startInFlight check-and-claim below must complete with no `await`
    // in between, mirroring ServerRegistry.getOrCreateEnvironment's
    // pending-map pattern: calling `this.doStart(data)` runs synchronously up
    // to its first internal `await` and returns a pending Promise, which is
    // assigned to `this.startInFlight` still within that same synchronous
    // turn. A second start() call arriving at any point after this line -
    // whether before or after doStart's own `isRunning()` check resolves -
    // will see `startInFlight` already set and reject immediately, instead of
    // both callers observing "not running" and both spawning a process.
    if (this.startInFlight) {
      throw new EnvironmentBusyError("server is already starting");
    }
    this.startInFlight = this.doStart(data);
    try {
      await this.startInFlight;
    } finally {
      this.startInFlight = null;
    }
  }

  private async doStart(data: ExecutionData): Promise<void> {
    if (await this.isRunning()) {
      throw new EnvironmentBusyError("server is already running");
    }
    await this.impl.executeAsync(data);
    this.setStatus({ running: true });
  }

  async stop(options: StopOptions = {}): Promise<void> {
    const timeoutMs = options.gracefulTimeoutMs ?? 5000;
    if (options.stopCommand) {
      await this.impl.sendCommand(options.stopCommand);
      if (await this.waitUntilStopped(timeoutMs)) return;
    }
    await this.impl.sendCode("SIGTERM");
    if (await this.waitUntilStopped(timeoutMs)) return;
    await this.impl.kill();
  }

  async kill(): Promise<void> {
    await this.impl.kill();
  }

  async sendCommand(command: string): Promise<void> {
    await this.impl.sendCommand(command);
  }

  async isRunning(): Promise<boolean> {
    return this.impl.isRunning();
  }

  async pollStats(): Promise<ServerStats> {
    const stats = await this.impl.getStats();
    this.emit("stat", stats);
    return stats;
  }

  private async waitUntilStopped(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!(await this.impl.isRunning())) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }
}
