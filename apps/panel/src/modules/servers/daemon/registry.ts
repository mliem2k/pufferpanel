import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Value, type ServerDefinitionType, ServerDefinition } from "../../templates/server-definition";
import { Environment } from "./environment";
import { TtyEnvironmentImpl } from "./tty-environment";
import { ReattachedEnvironmentImpl } from "./reattached-environment";
import { findContainer } from "./docker-client";
import { DockerEnvironmentImpl } from "./docker-environment";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class ServerRegistry {
  private environments = new Map<string, Environment>();
  private pending = new Map<string, Promise<Environment | null>>();

  constructor(private readonly dataDir: string) {}

  getServerDir(identifier: string): string {
    return join(this.dataDir, "servers", identifier, "files");
  }

  getPidFilePath(identifier: string): string {
    return join(this.dataDir, "servers", identifier, "server.pid");
  }

  getContainerName(identifier: string): string {
    return `pufferpanel-${identifier}`;
  }

  private getDefinitionPath(identifier: string): string {
    return join(this.dataDir, "servers", identifier, "definition.json");
  }

  async loadDefinition(identifier: string): Promise<ServerDefinitionType | null> {
    const raw = await readFile(this.getDefinitionPath(identifier), "utf-8").catch(() => null);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Value.Check(ServerDefinition, parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async getOrCreateEnvironment(identifier: string): Promise<Environment | null> {
    const existing = this.environments.get(identifier);
    if (existing) return existing;
    const inFlight = this.pending.get(identifier);
    if (inFlight) return inFlight;
    const promise = this.createEnvironment(identifier);
    this.pending.set(identifier, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(identifier);
    }
  }

  private async createEnvironment(identifier: string): Promise<Environment | null> {
    const definition = await this.loadDefinition(identifier);
    if (!definition) return null;

    if (definition.environment.type === "docker") {
      return this.createDockerEnvironment(identifier);
    }

    const pidFilePath = this.getPidFilePath(identifier);
    const rawPid = await readFile(pidFilePath, "utf-8").catch(() => null);
    if (rawPid !== null) {
      const parsedPid = Number(rawPid);
      const stalePid = Number.isInteger(parsedPid) && parsedPid > 0 ? parsedPid : undefined;
      if (stalePid !== undefined && isPidAlive(stalePid)) {
        const environment = new Environment(new ReattachedEnvironmentImpl(stalePid, pidFilePath));
        environment.reattachRunning();
        // A reattached Environment never gets a fresh call into
        // TtyEnvironmentImpl if it later dies (crash or explicit stop) - it
        // stays cached here forever and permanently rejects start() with a
        // non-EnvironmentBusyError. reattachRunning() above already fired one
        // synchronous "status" event; nothing else calls setStatus on a
        // reattached Environment except the impl's onExit wiring in
        // Environment's constructor (stop()/kill() never call setStatus
        // directly), so this `.once` can only ever fire on the death
        // transition. Evict on that transition so the next
        // getOrCreateEnvironment call falls through to a fresh
        // TtyEnvironmentImpl instead of returning this dead instance.
        environment.once("status", () => {
          this.environments.delete(identifier);
        });
        this.environments.set(identifier, environment);
        return environment;
      }
      await rm(pidFilePath, { force: true });
    }
    const environment = new Environment(new TtyEnvironmentImpl());
    this.environments.set(identifier, environment);
    return environment;
  }

  // Unlike the tty/reattachment path above, a Docker-backed Environment
  // never needs this kind of eviction: DockerEnvironmentImpl.executeAsync is
  // idempotently self-healing (it removes any existing container under its
  // name before creating a new one - see docker-environment.ts), so this
  // same cached instance can be started again later even after a previous
  // run already exited.
  private async createDockerEnvironment(identifier: string): Promise<Environment> {
    const containerName = this.getContainerName(identifier);
    const impl = new DockerEnvironmentImpl(containerName);
    const environment = new Environment(impl);
    const existing = await findContainer(containerName);
    if (existing?.running) {
      await impl.reattachToRunning(existing.id);
      environment.reattachRunning();
    }
    this.environments.set(identifier, environment);
    return environment;
  }
}
