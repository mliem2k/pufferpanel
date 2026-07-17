import { join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { PanelDb } from "@pufferpanel/models/db";
import { localTemplates, templateRepos } from "@pufferpanel/models/schema";
import { eq } from "drizzle-orm";
import {
  ServerDefinition,
  Value,
  type ServerDefinitionType,
} from "@pufferpanel/core/server-definition";

export interface LocalTemplateInput {
  name: string;
  definition: ServerDefinitionType;
}

export async function createLocalTemplate(db: PanelDb, input: LocalTemplateInput) {
  const [row] = await db
    .insert(localTemplates)
    .values({ name: input.name, definition: input.definition })
    .returning();
  return row;
}

export async function listLocalTemplates(db: PanelDb) {
  return db.select().from(localTemplates);
}

export async function getLocalTemplate(db: PanelDb, name: string) {
  const [row] = await db.select().from(localTemplates).where(eq(localTemplates.name, name));
  return row;
}

export async function deleteLocalTemplate(db: PanelDb, name: string) {
  await db.delete(localTemplates).where(eq(localTemplates.name, name));
}

export interface TemplateRepoInput {
  name: string;
  url: string;
}

export async function addTemplateRepo(
  db: PanelDb,
  input: TemplateRepoInput,
  cloneParentDir: string,
) {
  const targetDir = join(cloneParentDir, input.name);
  const clone = Bun.spawn(["git", "clone", input.url, targetDir]);
  const exitCode = await clone.exited;
  if (exitCode !== 0) {
    throw new Error(`git clone failed for template repo "${input.name}"`);
  }
  const [row] = await db
    .insert(templateRepos)
    .values({ name: input.name, url: input.url })
    .returning();
  return row;
}

export interface RepoTemplate {
  name: string;
  definition: ServerDefinitionType;
}

export async function listTemplateRepoTemplates(repoDir: string): Promise<RepoTemplate[]> {
  const entries = await readdir(repoDir, { withFileTypes: true });
  const templates: RepoTemplate[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".git") continue;
    const templatePath = join(repoDir, entry.name, "template.json");
    const raw = await readFile(templatePath, "utf-8").catch(() => null);
    if (!raw) continue;
    const parsed = JSON.parse(raw);
    if (!Value.Check(ServerDefinition, parsed)) continue;
    templates.push({ name: entry.name, definition: parsed });
  }
  return templates;
}
