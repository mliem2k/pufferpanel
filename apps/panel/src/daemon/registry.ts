import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Value, type ServerDefinitionType, ServerDefinition } from "@pufferpanel/core/server-definition";
import { Environment } from "@pufferpanel/core/environment";
import { TtyEnvironmentImpl } from "@pufferpanel/environments/tty";

export class ServerRegistry {
  private environments = new Map<string, Environment>();

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
    const parsed = JSON.parse(raw);
    if (!Value.Check(ServerDefinition, parsed)) return null;
    return parsed;
  }

  async getOrCreateEnvironment(identifier: string): Promise<Environment | null> {
    const existing = this.environments.get(identifier);
    if (existing) return existing;
    const definition = await this.loadDefinition(identifier);
    if (!definition) return null;
    const environment = new Environment(new TtyEnvironmentImpl());
    this.environments.set(identifier, environment);
    return environment;
  }
}
