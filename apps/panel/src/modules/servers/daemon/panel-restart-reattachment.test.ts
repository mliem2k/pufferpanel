import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treaty } from "@elysiajs/eden";
import { ServerRegistry } from "./registry";
import { createNodeApp } from "./node-app";

function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      if (await check()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error("waitFor timed out"));
      }
    }, 25);
  });
}

async function seedRunnableServer(dataDir: string, identifier: string, command: string): Promise<void> {
  const dir = join(dataDir, "servers", identifier);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "definition.json"),
    JSON.stringify({
      type: "test-server",
      display: "Test Server",
      environment: { type: "tty" },
      supportedEnvironments: [{ type: "tty" }],
      variables: {},
      execution: { command },
    }),
  );
}

describe("Panel restart reattachment", () => {
  test(
    "a server started before a Panel restart is reattached, not respawned, and remains stoppable",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "pfp-restart-"));
      await seedRunnableServer(dataDir, "mliem", 'sh -c "echo started >> marker.txt; exec sleep 30"');

      const registryBeforeRestart = new ServerRegistry(dataDir);
      const apiBeforeRestart = treaty(createNodeApp(registryBeforeRestart));
      const started = await apiBeforeRestart.servers({ identifier: "mliem" }).start.post();
      expect(started.error).toBeNull();

      const markerPath = join(registryBeforeRestart.getServerDir("mliem"), "marker.txt");
      await waitFor(async () => await Bun.file(markerPath).exists());
      const markerBeforeRestart = await readFile(markerPath, "utf-8");
      expect(markerBeforeRestart).toBe("started\n");

      const pidFilePath = registryBeforeRestart.getPidFilePath("mliem");
      await waitFor(async () => await Bun.file(pidFilePath).exists());
      const pidBeforeRestart = await readFile(pidFilePath, "utf-8");

      // Simulate the Panel process restarting: production shutdown (index.ts)
      // never stops tracked Environments, so a fresh ServerRegistry against
      // the same dataDir is exactly what a fresh Panel boot constructs.
      const registryAfterRestart = new ServerRegistry(dataDir);
      const apiAfterRestart = treaty(createNodeApp(registryAfterRestart));

      const statusAfterRestart = await apiAfterRestart.servers({ identifier: "mliem" }).status.get();
      expect(statusAfterRestart.data?.running).toBe(true);

      const pidAfterRestart = await readFile(pidFilePath, "utf-8");
      expect(pidAfterRestart).toBe(pidBeforeRestart);

      // If reattachment had instead respawned the process, the shell command
      // would run a second time and append a second "started" line.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const markerAfterRestart = await readFile(markerPath, "utf-8");
      expect(markerAfterRestart).toBe("started\n");

      const stopped = await apiAfterRestart.servers({ identifier: "mliem" }).stop.post();
      expect(stopped.error).toBeNull();
      await waitFor(async () => {
        const status = await apiAfterRestart.servers({ identifier: "mliem" }).status.get();
        return status.data?.running === false;
      });
      await waitFor(async () => !(await Bun.file(pidFilePath).exists()));

      await rm(dataDir, { recursive: true, force: true });
    },
    15000,
  );
});
