import pidusage from "pidusage";
import type { EnvironmentImpl, ExecutionData, ServerStats } from "@pufferpanel/core/environment-impl";

// Splits a shell-style command string into argv tokens.
//
// A naive `command.split(" ")` (the previous implementation) mis-tokenizes
// two common cases: a double-quoted argument containing a space (e.g. a
// quoted jar path) gets split apart instead of staying one token, and any
// accidental double space between tokens produces a spurious empty-string
// argv entry. This tokenizer instead splits on whitespace runs, but treats a
// `"..."`-quoted span as a single token with the quotes stripped.
//
// Intentionally minimal: no escaping of embedded quotes, no single-quote
// support, no shell metacharacter handling (globs, pipes, env expansion,
// etc.) - this only needs to cover plain `command arg "quoted arg" ...`
// strings like `java -jar "my server.jar" --nogui`.
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let hasToken = false;

  for (const char of command) {
    if (char === '"') {
      inQuotes = !inQuotes;
      hasToken = true;
      continue;
    }
    if (!inQuotes && /\s/.test(char)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

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
    const [cmd, ...args] = tokenizeCommand(data.command);
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
    const sink = this.proc.stdin as unknown as {
      write(data: string): number | Promise<number>;
      flush(): number | Promise<number>;
    };
    await sink.write(`${command}\n`);
    await sink.flush();
  }

  async getStats(): Promise<ServerStats> {
    if (!this.proc || !(await this.isRunning())) return { cpu: 0, memory: 0 };
    try {
      const stats = await pidusage(this.proc.pid);
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
    if (!this.proc) return false;
    return this.proc.exitCode === null && this.proc.signalCode === null;
  }
}
