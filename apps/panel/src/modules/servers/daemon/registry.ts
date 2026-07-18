import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Value, type ServerDefinitionType, ServerDefinition } from "../../templates/server-definition";
import { Environment } from "./environment";
import { TtyEnvironmentImpl } from "./tty-environment";
import { ReattachedEnvironmentImpl } from "./reattached-environment";
import { findContainer, type ContainerInfo } from "./docker-client";
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
    // findContainer throws on any real Docker daemon error other than 404
    // (see docker-client.ts). getOrCreateEnvironment's contract - relied on
    // by every other caller in this class, and critically by the WS
    // /servers/:identifier/socket "open" handler, which has no error
    // handler and would otherwise hang the socket open forever with no
    // listeners - is to always resolve (Environment or null), never
    // reject. Treat a genuine Docker-connectivity failure here the same as
    // "no existing container found" for THIS call and fall through to
    // constructing a fresh, not-yet-started environment; a truly broken
    // daemon will surface loudly and safely later, when the caller's own
    // start() call reaches DockerEnvironmentImpl.executeAsync through the
    // HTTP start route's existing try/catch.
    //
    // Crucially, a thrown error is NOT the same as a legitimate "not found"
    // (findContainer resolving null) when it comes to CACHING: unlike the
    // tty/reattachment path above, a Docker-backed environment is never
    // evicted from `this.environments`, so caching a "blind"
    // (never-reattached) Environment now would serve it forever - silently
    // reporting a genuinely-running container as stopped until the whole
    // Panel process restarts. So only cache when the check didn't throw;
    // when it threw, still return a usable environment for this call, but
    // let the NEXT getOrCreateEnvironment call for this identifier retry
    // the reattach check from scratch instead of being stuck with a
    // permanently-blind cached entry.
    let existing: ContainerInfo | null = null;
    let checkFailed = false;
    try {
      existing = await findContainer(containerName);
    } catch {
      checkFailed = true;
    }
    if (existing?.running) {
      await impl.reattachToRunning(existing.id);
      environment.reattachRunning();
    }
    if (!checkFailed) {
      this.environments.set(identifier, environment);
    }
    return environment;
  }
}
