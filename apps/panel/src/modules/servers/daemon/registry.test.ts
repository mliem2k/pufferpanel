import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServerRegistry } from "./registry";

async function seedDefinition(dataDir: string, identifier: string, definition: unknown): Promise<void> {
  const dir = join(dataDir, "servers", identifier);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "definition.json"), JSON.stringify(definition));
}

describe("ServerRegistry", () => {
  test("loadDefinition returns null for an identifier with no definition file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    const registry = new ServerRegistry(dataDir);
    expect(await registry.loadDefinition("missing")).toBeNull();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("loadDefinition reads and validates a real definition file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const registry = new ServerRegistry(dataDir);
    const definition = await registry.loadDefinition("mliem");
    expect(definition?.type).toBe("minecraft-purpur");
    await rm(dataDir, { recursive: true, force: true });
  });

  test("getOrCreateEnvironment returns null when no definition exists", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    const registry = new ServerRegistry(dataDir);
    expect(await registry.getOrCreateEnvironment("missing")).toBeNull();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("getOrCreateEnvironment returns the same Environment instance on repeated calls", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const registry = new ServerRegistry(dataDir);
    const first = await registry.getOrCreateEnvironment("mliem");
    const second = await registry.getOrCreateEnvironment("mliem");
    expect(first).not.toBeNull();
    expect(first).toBe(second);
    await rm(dataDir, { recursive: true, force: true });
  });

  test("loadDefinition returns null for malformed JSON instead of throwing", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    const dir = join(dataDir, "servers", "broken");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "definition.json"), "{ this is not valid json");
    const registry = new ServerRegistry(dataDir);
    expect(await registry.loadDefinition("broken")).toBeNull();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("concurrent getOrCreateEnvironment calls for the same identifier share one Environment instance", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const registry = new ServerRegistry(dataDir);
    const [first, second] = await Promise.all([
      registry.getOrCreateEnvironment("mliem"),
      registry.getOrCreateEnvironment("mliem"),
    ]);
    expect(first).not.toBeNull();
    expect(first).toBe(second);
    await rm(dataDir, { recursive: true, force: true });
  });
});
