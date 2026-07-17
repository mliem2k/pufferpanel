import { describe, expect, test } from "bun:test";
import { Environment } from "@pufferpanel/core/environment";
import { TtyEnvironmentImpl } from "./tty";

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

describe("Environment stats polling against a real TtyEnvironmentImpl process", () => {
  test(
    "stats arrive periodically for a running process, and stop once it's killed",
    async () => {
      const impl = new TtyEnvironmentImpl();
      const env = new Environment(impl);
      const stats: Array<{ cpu: number; memory: number }> = [];
      env.on("stat", (s: { cpu: number; memory: number }) => stats.push(s));

      try {
        // Before this fix, nothing in production code ever called
        // pollStats(): a client subscribing to `?stats=true` got silence
        // forever. Environment.start() must now kick off periodic polling on
        // its own.
        await env.start({ command: "sleep 10", cwd: "." });

        // Wait for at least two poll cycles - proves this is a real periodic
        // poll, not a one-off fluke emission.
        await waitFor(() => stats.length >= 2, 6000);
        expect(stats.length).toBeGreaterThanOrEqual(2);
        for (const stat of stats) {
          expect(typeof stat.cpu).toBe("number");
          expect(typeof stat.memory).toBe("number");
          expect(stat.memory).toBeGreaterThan(0);
        }

        // Killing the process must stop the poll loop: no dangling interval,
        // no further stat events.
        const countAtKill = stats.length;
        await env.kill();
        await waitFor(async () => !(await env.isRunning()));

        // Wait past one more poll interval. If the interval weren't cleared,
        // this would pick up at least one more stat event.
        await new Promise((resolve) => setTimeout(resolve, 2300));
        expect(stats.length).toBe(countAtKill);
      } finally {
        await env.kill().catch(() => {});
      }
    },
    10000,
  );

  test(
    "a process that exits on its own also stops the stats poll (via onExit)",
    async () => {
      const impl = new TtyEnvironmentImpl();
      const env = new Environment(impl);
      const stats: Array<{ cpu: number; memory: number }> = [];
      env.on("stat", (s: { cpu: number; memory: number }) => stats.push(s));

      // A short-lived process that exits well before the next poll tick,
      // without ever going through Environment.stop()/kill().
      await env.start({ command: "sleep 0.2", cwd: "." });
      await waitFor(async () => !(await env.isRunning()));

      const countAtExit = stats.length;
      // Give a full poll interval to elapse. If onExit hadn't cleared the
      // timer, a stray poll would still fire and observe a dead process.
      await new Promise((resolve) => setTimeout(resolve, 2300));
      expect(stats.length).toBe(countAtExit);
    },
    10000,
  );
});
