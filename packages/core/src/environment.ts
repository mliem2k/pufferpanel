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

export class Environment extends EventEmitter {
  private consoleBuffer: string[] = [];
  private status: ServerStatus = { running: false, installing: false };

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
    if (await this.isRunning()) {
      throw new Error("server is already running");
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
