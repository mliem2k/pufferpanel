import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInstall, runUninstall } from "./execution";
import type { ServerDefinitionType } from "./server-definition";

function baseDefinition(overrides: Partial<ServerDefinitionType>): ServerDefinitionType {
  return {
    type: "test-server",
    display: "Test Server",
    environment: { type: "tty" },
    supportedEnvironments: [{ type: "tty" }],
    variables: {},
    execution: { command: "echo run" },
    ...overrides,
  };
}

describe("template execution", () => {
  test("runInstall runs command steps in order in the server directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pfp-install-"));
    const definition = baseDefinition({
      installation: [
        { type: "command", command: "echo one > step-one.txt" },
        { type: "command", command: "echo two > step-two.txt" },
      ],
    });
    await runInstall(dir, definition, {});
    expect((await readFile(join(dir, "step-one.txt"), "utf-8")).trim()).toBe("one");
    expect((await readFile(join(dir, "step-two.txt"), "utf-8")).trim()).toBe("two");
    await rm(dir, { recursive: true, force: true });
  });

  test("runInstall substitutes variables into command steps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pfp-install-"));
    const definition = baseDefinition({
      installation: [{ type: "command", command: "echo {{greeting}} > out.txt" }],
    });
    await runInstall(dir, definition, { greeting: "hi-there" });
    expect((await readFile(join(dir, "out.txt"), "utf-8")).trim()).toBe("hi-there");
    await rm(dir, { recursive: true, force: true });
  });

  test("runInstall throws and stops on a non-zero exit code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pfp-install-"));
    const definition = baseDefinition({
      installation: [
        { type: "command", command: "exit 1" },
        { type: "command", command: "echo should-not-run > never.txt" },
      ],
    });
    await expect(runInstall(dir, definition, {})).rejects.toThrow();
    await expect(readFile(join(dir, "never.txt"), "utf-8")).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  test("runUninstall runs its own steps independently of installation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pfp-uninstall-"));
    const definition = baseDefinition({
      uninstallation: [{ type: "command", command: "echo removed > removed.txt" }],
    });
    await runUninstall(dir, definition, {});
    expect((await readFile(join(dir, "removed.txt"), "utf-8")).trim()).toBe("removed");
    await rm(dir, { recursive: true, force: true });
  });
});
