import pidusage from "pidusage";
import type { EnvironmentImpl, ExecutionData, ServerStats } from "@pufferpanel/core/environment-impl";

export class TtyEnvironmentImpl implements EnvironmentImpl {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private running = false;
  private consoleListener: ((line: string) => void) | null = null;
  private exitListener: (() => void) | null = null;

  onConsoleLine(listener: (line: string) => void): void {
    this.consoleListener = listener;
  }

  onExit(listener: () => void): void {
    this.exitListener = listener;
  }

  async executeAsync(data: ExecutionData): Promise<void> {
    const [cmd, ...args] = data.command.split(" ");
    this.proc = Bun.spawn([cmd!, ...args], {
      cwd: data.cwd,
      env: { ...process.env, ...(data.env ?? {}) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.running = true;
    void this.pumpLines(this.proc.stdout);
    void this.pumpLines(this.proc.stderr);
    void this.proc.exited.then(() => {
      this.running = false;
      this.exitListener?.();
    });
  }

  private async pumpLines(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        this.consoleListener?.(line);
      }
    }
  }

  async kill(): Promise<void> {
    this.proc?.kill("SIGKILL");
  }

  async sendCode(signal: string): Promise<void> {
    this.proc?.kill(signal as Parameters<NonNullable<typeof this.proc>["kill"]>[0]);
  }

  async sendCommand(command: string): Promise<void> {
    if (!this.proc) return;
    const sink = this.proc.stdin as unknown as { write(data: string): void; flush(): void };
    sink.write(`${command}\n`);
    sink.flush();
  }

  async getStats(): Promise<ServerStats> {
    if (!this.proc || !this.running) return { cpu: 0, memory: 0 };
    const stats = await pidusage(this.proc.pid);
    return { cpu: stats.cpu, memory: stats.memory };
  }

  getUid(): number {
    return typeof process.getuid === "function" ? process.getuid() : 0;
  }

  getGid(): number {
    return typeof process.getgid === "function" ? process.getgid() : 0;
  }

  async isRunning(): Promise<boolean> {
    return this.running;
  }
}
