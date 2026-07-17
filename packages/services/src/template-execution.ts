import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { InstallStepType, ServerDefinitionType } from "@pufferpanel/core/server-definition";

function substitute(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => variables[name] ?? "");
}

async function runStep(serverDir: string, step: InstallStepType, variables: Record<string, string>): Promise<void> {
  if (step.type === "download") {
    const url = substitute(step.url, variables);
    const targetPath = join(serverDir, substitute(step.targetPath, variables));
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`download step failed: ${url} returned ${response.status}`);
    }
    await Bun.write(targetPath, await response.arrayBuffer());
    return;
  }
  const command = substitute(step.command, variables);
  const proc = Bun.spawn(["sh", "-c", command], { cwd: serverDir, stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`command step failed with exit code ${exitCode}: ${command}`);
  }
}

async function runSteps(
  serverDir: string,
  steps: InstallStepType[] | undefined,
  variables: Record<string, string>,
): Promise<void> {
  await mkdir(serverDir, { recursive: true });
  for (const step of steps ?? []) {
    await runStep(serverDir, step, variables);
  }
}

export async function runInstall(
  serverDir: string,
  definition: ServerDefinitionType,
  variables: Record<string, string>,
): Promise<void> {
  await runSteps(serverDir, definition.installation, variables);
}

export async function runUninstall(
  serverDir: string,
  definition: ServerDefinitionType,
  variables: Record<string, string>,
): Promise<void> {
  await runSteps(serverDir, definition.uninstallation, variables);
}
