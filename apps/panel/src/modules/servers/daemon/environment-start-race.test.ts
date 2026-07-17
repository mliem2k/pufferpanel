import { describe, expect, test } from "bun:test";
import { Environment } from "./environment";
import { TtyEnvironmentImpl } from "./tty-environment";

function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
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
    }, 20);
  });
}

function pgrepCount(marker: string): number {
  const result = Bun.spawnSync(["pgrep", "-f", marker]);
  const output = new TextDecoder().decode(result.stdout).trim();
  return output === "" ? 0 : output.split("\n").length;
}

describe("Environment.start() concurrency against a real TtyEnvironmentImpl process", () => {
  test("multiple truly-concurrent start() calls spawn exactly one real process", async () => {
    // Unique marker per run so pgrep never matches a leftover/unrelated process.
    const marker = `sleep ${400 + Math.floor(Math.random() * 500)}`;
    const impl = new TtyEnvironmentImpl();
    const env = new Environment(impl);

    try {
      // Fire several truly concurrent start() calls against the same real
      // environment. Before the in-flight-promise guard, this reproduced the
      // reviewer's finding in 5/5 runs: every call observed isRunning() ===
      // false and every call spawned its own real `sleep` process.
      const results = await Promise.allSettled([
        env.start({ command: marker, cwd: "." }),
        env.start({ command: marker, cwd: "." }),
        env.start({ command: marker, cwd: "." }),
        env.start({ command: marker, cwd: "." }),
        env.start({ command: marker, cwd: "." }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);

      await waitFor(() => pgrepCount(marker) > 0);
      // Give any (incorrect) extra spawn a moment to appear before counting.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(pgrepCount(marker)).toBe(1);
      expect(await env.isRunning()).toBe(true);
    } finally {
      await env.kill().catch(() => {});
      if (pgrepCount(marker) > 0) {
        Bun.spawnSync(["pkill", "-f", marker]);
      }
      await waitFor(() => pgrepCount(marker) === 0).catch(() => {});
    }
  });
});
