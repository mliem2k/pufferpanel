// @ts-expect-error
import pidusage from "pidusage";
import type { EnvironmentImpl, ExecutionData, ServerStats } from "./environment-impl";
import { rm } from "node:fs/promises";

const REATTACHED_POLL_INTERVAL_MS = 2000;

export class ReattachedEnvironmentImpl implements EnvironmentImpl {
  private exitListener: (() => void) | null = null;

  constructor(
    private readonly pid: number,
    private readonly pidFilePath?: string,
  ) {
    this.startPolling();
  }

  private startPolling(): void {
    const interval = setInterval(async () => {
      if (!(await this.isRunning())) {
        clearInterval(interval);
        if (this.pidFilePath) {
          await rm(this.pidFilePath, { force: true });
        }
        this.exitListener?.();
      }
    }, REATTACHED_POLL_INTERVAL_MS);
    interval.unref();
  }

  onConsoleLine(_listener: (line: string) => void): void {}

  onExit(listener: () => void): void {
    this.exitListener = listener;
  }

  async executeAsync(_data: ExecutionData): Promise<void> {
    throw new Error("cannot execute a new process through a reattached environment");
  }

  async kill(): Promise<void> {
    try {
      process.kill(this.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }

  async sendCode(signal: string): Promise<void> {
    try {
      process.kill(this.pid, signal);
    } catch {
      // already gone
    }
  }

  async sendCommand(_command: string): Promise<void> {
    throw new Error("console is unavailable for a reattached server; restart it to regain console access");
  }

  async getStats(): Promise<ServerStats> {
    try {
      const stats = await pidusage(this.pid);
      return { cpu: stats.cpu, memory: stats.memory };
    } catch {
      return { cpu: 0, memory: 0 };
    }
  }

  getUid(): number {
    return typeof process.getuid === "function" ? process.getuid() : 0;
  }

  getGid(): number {
    return typeof process.getgid === "function" ? process.getgid() : 0;
  }

  async isRunning(): Promise<boolean> {
    try {
      process.kill(this.pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
