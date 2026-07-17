import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { ServerDefinition } from "./server-definition";

describe("ServerDefinition with install/uninstall steps", () => {
  test("accepts a definition with installation and uninstallation steps", () => {
    const definition = {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "java -jar purpur.jar" },
      installation: [
        { type: "download", url: "https://example.com/purpur.jar", targetPath: "purpur.jar" },
        { type: "command", command: "echo installed" },
      ],
      uninstallation: [{ type: "command", command: "rm -rf ." }],
    };
    expect(Value.Check(ServerDefinition, definition)).toBe(true);
  });

  test("still accepts a Phase 1 definition with no installation/uninstallation fields", () => {
    const definition = {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "java -jar purpur.jar" },
    };
    expect(Value.Check(ServerDefinition, definition)).toBe(true);
  });

  test("rejects an install step with an unknown type", () => {
    const definition = {
      type: "minecraft-purpur",
      display: "Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command: "java -jar purpur.jar" },
      installation: [{ type: "unzip", path: "x.zip" }],
    };
    expect(Value.Check(ServerDefinition, definition)).toBe(false);
  });
});
