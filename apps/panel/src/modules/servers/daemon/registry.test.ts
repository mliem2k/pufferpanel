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

  test("reattaches to a live external process recorded in the pid file instead of spawning fresh", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const proc = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
    const registry = new ServerRegistry(dataDir);
    await mkdir(join(dataDir, "servers", "mliem"), { recursive: true });
    await writeFile(registry.getPidFilePath("mliem"), String(proc.pid));

    const environment = await registry.getOrCreateEnvironment("mliem");
    expect(environment?.getStatus().running).toBe(true);
    expect(await environment?.isRunning()).toBe(true);

    proc.kill("SIGKILL");
    await proc.exited;
    await rm(dataDir, { recursive: true, force: true });
  });

  test("falls back to a fresh TtyEnvironmentImpl and removes the stale pid file when the recorded pid is dead", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-registry-"));
    await seedDefinition(dataDir, "mliem", {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "echo hi" },
    });
    const deadProc = Bun.spawn(["true"], { stdout: "ignore", stderr: "ignore" });
    await deadProc.exited;
    const registry = new ServerRegistry(dataDir);
    await mkdir(join(dataDir, "servers", "mliem"), { recursive: true });
    const pidFilePath = registry.getPidFilePath("mliem");
    await writeFile(pidFilePath, String(deadProc.pid));

    const environment = await registry.getOrCreateEnvironment("mliem");
    expect(environment?.getStatus().running).toBe(false);
    expect(await Bun.file(pidFilePath).exists()).toBe(false);

    await rm(dataDir, { recursive: true, force: true });
  });

  test("treats pid 0 as invalid, falls back to fresh spawn, and removes the file", async () => {
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
    await mkdir(join(dataDir, "servers", "mliem"), { recursive: true });
    const pidFilePath = registry.getPidFilePath("mliem");
    await writeFile(pidFilePath, "0");

    const environment = await registry.getOrCreateEnvironment("mliem");
    expect(environment?.getStatus().running).toBe(false);
    expect(await Bun.file(pidFilePath).exists()).toBe(false);

    await rm(dataDir, { recursive: true, force: true });
  });

  test("treats non-numeric pid file content as invalid, falls back to fresh spawn, and removes the file", async () => {
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
    await mkdir(join(dataDir, "servers", "mliem"), { recursive: true });
    const pidFilePath = registry.getPidFilePath("mliem");
    await writeFile(pidFilePath, "not-a-pid");

    const environment = await registry.getOrCreateEnvironment("mliem");
    expect(environment?.getStatus().running).toBe(false);
    expect(await Bun.file(pidFilePath).exists()).toBe(false);

    await rm(dataDir, { recursive: true, force: true });
  });
});
