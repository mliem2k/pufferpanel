import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../db/test-helper";
import {
  createLocalTemplate,
  listLocalTemplates,
  addTemplateRepo,
  listTemplateRepoTemplates,
} from "./service";

async function createFixtureGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pfp-template-repo-"));
  await Bun.spawn(["git", "init"], { cwd: dir }).exited;
  await mkdir(join(dir, "minecraft-purpur"), { recursive: true });
  await writeFile(
    join(dir, "minecraft-purpur", "template.json"),
    JSON.stringify({
      type: "minecraft-purpur",
      display: "Minecraft: Purpur",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }, { type: "docker" }],
      variables: {},
      execution: { command: "java -jar purpur.jar", stopCommand: "stop" },
    }),
  );
  await Bun.spawn(["git", "add", "-A"], { cwd: dir }).exited;
  await Bun.spawn(
    ["git", "-c", "user.email=test@test.local", "-c", "user.name=test", "commit", "-m", "seed"],
    { cwd: dir },
  ).exited;
  return dir;
}

describe("local templates", () => {
  test("creates and lists a local template", async () => {
    const db = createTestDb();
    await createLocalTemplate(db, {
      name: "custom-purpur",
      definition: {
        type: "minecraft-purpur",
        display: "Custom Purpur",
        environment: { type: "tty" },
        supportedEnvironments: [{ type: "tty" }],
        variables: {},
        execution: { command: "java -jar purpur.jar" },
      },
    });
    const list = await listLocalTemplates(db);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("custom-purpur");
  });
});

describe("template repo import", () => {
  test("clones a repo and lists its folder templates", async () => {
    const db = createTestDb();
    const fixtureRepo = await createFixtureGitRepo();
    const cloneDir = await mkdtemp(join(tmpdir(), "pfp-clone-"));
    await addTemplateRepo(db, { name: "community", url: fixtureRepo }, cloneDir);
    const templates = await listTemplateRepoTemplates(join(cloneDir, "community"));
    expect(templates).toHaveLength(1);
    expect(templates[0]?.definition.type).toBe("minecraft-purpur");
  });
});
