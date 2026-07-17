import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Value, type ServerDefinitionType, ServerDefinition } from "../../templates/server-definition";
import { Environment } from "./environment";
import { TtyEnvironmentImpl } from "./tty-environment";

export class ServerRegistry {
  private environments = new Map<string, Environment>();
  private pending = new Map<string, Promise<Environment | null>>();

  constructor(private readonly dataDir: string) {}

  getServerDir(identifier: string): string {
    return join(this.dataDir, "servers", identifier, "files");
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
    const environment = new Environment(new TtyEnvironmentImpl());
    this.environments.set(identifier, environment);
    return environment;
  }
}
