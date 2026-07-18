import { dockerFetch, attach, DockerFrameDemuxer, type AttachConnection } from "./docker-client";
import { tokenizeCommand } from "./tty-environment";
import type { EnvironmentImpl, ExecutionData, ServerStats } from "./environment-impl";

export class DockerEnvironmentImpl implements EnvironmentImpl {
  private containerId: string | null = null;
  private connection: AttachConnection | null = null;
  private consoleListener: ((line: string) => void) | null = null;
  private exitListener: (() => void) | null = null;
  private lineBuffer = "";
  private readonly decoder = new TextDecoder();

  constructor(private readonly containerName: string) {}

  async executeAsync(data: ExecutionData): Promise<void> {
    // Idempotent by construction: remove any existing container under this
    // name first (a 404 here just means there was nothing to remove - this
    // is the expected, common case). This is what lets this exact instance
    // be started again later even after a previous run already exited,
    // with no eviction/cache-replacement logic needed anywhere upstream.
    await dockerFetch(`/containers/${this.containerName}?force=true`, { method: "DELETE" }).catch(() => {});

    const [cmd, ...args] = tokenizeCommand(data.command);
    const createRes = await dockerFetch(`/containers/create?name=${this.containerName}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        Image: data.image,
        Cmd: [cmd!, ...args],
        WorkingDir: "/data",
        Env: Object.entries(data.env ?? {}).map(([key, value]) => `${key}=${value}`),
        HostConfig: {
          NetworkMode: "host",
          Binds: [`${data.cwd}:/data`],
        },
        OpenStdin: true,
        StdinOnce: false,
        Tty: false,
      }),
    });
    if (!createRes.ok) {
      const body = await createRes.json().catch(() => ({}));
      throw new Error(`docker container create failed: ${createRes.status} ${JSON.stringify(body)}`);
    }
    const created = (await createRes.json()) as { Id: string };
    this.containerId = created.Id;

    const startRes = await dockerFetch(`/containers/${this.containerId}/start`, { method: "POST" });
    if (!startRes.ok) {
      throw new Error(`docker container start failed: ${startRes.status}`);
    }

    await this.openAttach();
  }

  async reattachToRunning(containerId: string): Promise<void> {
    this.containerId = containerId;
    await this.openAttach();
  }

  private async openAttach(): Promise<void> {
    const connection = await attach(this.containerId!);
    this.connection = connection;
    this.lineBuffer = "";
    const demuxer = new DockerFrameDemuxer();
    connection.onData((chunk) => {
      // Same stale-connection hazard as onClose below: on a self-healing
      // restart, the OLD container's socket can deliver trailing/buffered
      // stdout bytes AFTER a NEW openAttach() has already reset state for
      // the new container. Without this guard those stale bytes would get
      // appended into the new container's live line buffer and could be
      // emitted to the current console listener as if they came from the
      // new container.
      if (this.connection !== connection) return;
      for (const f of demuxer.push(chunk)) {
        this.pushConsoleBytes(f.payload);
      }
    });
    connection.onClose(() => {
      // Only clear state / fire the exit listener if this connection is
      // still the one this instance is tracking. On the self-healing
      // restart path (kill -> executeAsync again on the SAME instance),
      // the OLD run's attach socket can emit its close event AFTER a NEW
      // openAttach() call has already installed a newer connection - a
      // stale close callback must not null out the valid new connection
      // or fire a spurious exit for a container this instance no longer
      // represents.
      if (this.connection === connection) {
        this.connection = null;
        this.exitListener?.();
      }
    });
  }

  private pushConsoleBytes(payload: Uint8Array): void {
    this.lineBuffer += this.decoder.decode(payload, { stream: true });
    const lines = this.lineBuffer.split("\n");
    this.lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      this.consoleListener?.(line);
    }
  }

  onConsoleLine(listener: (line: string) => void): void {
    this.consoleListener = listener;
  }

  onExit(listener: () => void): void {
    this.exitListener = listener;
  }

  async kill(): Promise<void> {
    if (!this.containerId) return;
    const res = await dockerFetch(`/containers/${this.containerId}/kill`, { method: "POST" });
    // 404 = container already gone, 409 = container not running - both are
    // benign "nothing to do" outcomes, not real failures.
    if (!res.ok && res.status !== 404 && res.status !== 409) {
      throw new Error(`docker container kill failed: ${res.status}`);
    }
  }

  async sendCode(signal: string): Promise<void> {
    if (!this.containerId) return;
    const res = await dockerFetch(`/containers/${this.containerId}/kill?signal=${signal}`, { method: "POST" });
    if (!res.ok && res.status !== 404 && res.status !== 409) {
      throw new Error(`docker container kill (signal ${signal}) failed: ${res.status}`);
    }
  }

  async sendCommand(command: string): Promise<void> {
    this.connection?.write(`${command}\n`);
  }

  async getStats(): Promise<ServerStats> {
    if (!this.containerId || !(await this.isRunning())) return { cpu: 0, memory: 0 };
    try {
      const res = await dockerFetch(`/containers/${this.containerId}/stats?stream=false`);
      const stats = (await res.json()) as {
        cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number; online_cpus?: number };
        precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
        memory_stats: { usage: number };
      };
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const onlineCpus = stats.cpu_stats.online_cpus || 1;
      const cpu = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;
      return { cpu, memory: stats.memory_stats.usage };
    } catch {
      return { cpu: 0, memory: 0 };
    }
  }

  getUid(): number {
    return 0;
  }

  getGid(): number {
    return 0;
  }

  async isRunning(): Promise<boolean> {
    if (!this.containerId) return false;
    try {
      const res = await dockerFetch(`/containers/${this.containerId}/json`);
      if (!res.ok) return false;
      const inspect = (await res.json()) as { State?: { Running?: boolean } };
      return inspect.State?.Running === true;
    } catch {
      return false;
    }
  }
}
