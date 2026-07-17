import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treaty } from "@elysiajs/eden";
import { ServerRegistry } from "./registry";
import { createNodeApp } from "./app";

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

function openSocket(port: number, identifier: string, query: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/servers/${identifier}/socket?${query}`);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", (event) => reject(event), { once: true });
  });
}

function closeSocket(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.addEventListener("close", () => resolve(), { once: true });
    ws.close();
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

describe("Node app", () => {
  test("status returns 404 for a server with no definition", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-nodeapp-"));
    const registry = new ServerRegistry(dataDir);
    const api = treaty(createNodeApp(registry));
    const { error } = await api.servers({ identifier: "missing" }).status.get();
    expect(error?.status).toBe(404);
  });

  test("start, status, and stop work end to end against a real process", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-nodeapp-"));
    await seedRunnableServer(dataDir, "mliem", "sleep 5");
    const registry = new ServerRegistry(dataDir);
    const api = treaty(createNodeApp(registry));

    const started = await api.servers({ identifier: "mliem" }).start.post();
    expect(started.error).toBeNull();

    let running = false;
    for (let attempt = 0; attempt < 20 && !running; attempt++) {
      const { data } = await api.servers({ identifier: "mliem" }).status.get();
      running = data?.running === true;
      if (!running) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(running).toBe(true);

    const stopped = await api.servers({ identifier: "mliem" }).stop.post();
    expect(stopped.error).toBeNull();
  });

  test("closing a websocket connection removes its listeners from the Environment", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-nodeapp-wsleak-"));
    await seedRunnableServer(dataDir, "wsleak", "sleep 5");
    const registry = new ServerRegistry(dataDir);
    const app = createNodeApp(registry);
    app.listen(0);
    const port = (app.server as { port: number }).port;

    try {
      const environment = await registry.getOrCreateEnvironment("wsleak");
      expect(environment).not.toBeNull();

      // 15 sequential connect/disconnect cycles: the reviewer's original repro
      // hit Node's MaxListenersExceededWarning on the 11th connection because
      // nothing removed the listener registered in `open` on disconnect.
      for (let i = 0; i < 15; i++) {
        const ws = await openSocket(port, "wsleak", "console=true&stats=true&status=true");
        await waitFor(() => environment!.listenerCount("console") === 1);
        expect(environment!.listenerCount("console")).toBe(1);
        expect(environment!.listenerCount("stat")).toBe(1);
        expect(environment!.listenerCount("status")).toBe(1);

        await closeSocket(ws);
        await waitFor(() => environment!.listenerCount("console") === 0);
        expect(environment!.listenerCount("console")).toBe(0);
        expect(environment!.listenerCount("stat")).toBe(0);
        expect(environment!.listenerCount("status")).toBe(0);
      }

      // Concurrent connections: listener count must track exactly the number
      // of currently-open sockets, and closing one must not remove another's.
      const sockets = await Promise.all([
        openSocket(port, "wsleak", "console=true"),
        openSocket(port, "wsleak", "console=true"),
        openSocket(port, "wsleak", "console=true"),
      ]);
      await waitFor(() => environment!.listenerCount("console") === 3);
      expect(environment!.listenerCount("console")).toBe(3);

      await closeSocket(sockets[0]!);
      await waitFor(() => environment!.listenerCount("console") === 2);
      expect(environment!.listenerCount("console")).toBe(2);

      await Promise.all([closeSocket(sockets[1]!), closeSocket(sockets[2]!)]);
      await waitFor(() => environment!.listenerCount("console") === 0);
      expect(environment!.listenerCount("console")).toBe(0);
    } finally {
      await app.stop();
    }
  });

  test("a second start while running returns 409 and does not spawn a second process", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-nodeapp-doublestart-"));
    const marker = `sleep ${300 + Math.floor(Math.random() * 500)}`;
    await seedRunnableServer(dataDir, "doublestart", marker);
    const registry = new ServerRegistry(dataDir);
    const api = treaty(createNodeApp(registry));

    try {
      const first = await api.servers({ identifier: "doublestart" }).start.post();
      expect(first.error).toBeNull();

      let running = false;
      for (let attempt = 0; attempt < 20 && !running; attempt++) {
        const { data } = await api.servers({ identifier: "doublestart" }).status.get();
        running = data?.running === true;
        if (!running) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(running).toBe(true);

      const second = await api.servers({ identifier: "doublestart" }).start.post();
      expect(second.error?.status).toBe(409);

      // Give an (incorrect) second spawn a moment to appear before counting.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(pgrepCount(marker)).toBe(1);

      const stopped = await api.servers({ identifier: "doublestart" }).stop.post();
      expect(stopped.error).toBeNull();
      await waitFor(() => pgrepCount(marker) === 0);
      expect(pgrepCount(marker)).toBe(0);
    } finally {
      // Best-effort cleanup in case an assertion above failed before stop().
      if (pgrepCount(marker) > 0) {
        Bun.spawnSync(["pkill", "-f", marker]);
      }
    }
  });
});
