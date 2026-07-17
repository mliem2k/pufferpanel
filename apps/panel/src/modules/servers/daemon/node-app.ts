import { mkdir } from "node:fs/promises";
import { Elysia, status, t } from "elysia";
import { EnvironmentBusyError, type Environment } from "./environment";
import type { ServerRegistry } from "./registry";

const ALREADY_RUNNING_MESSAGE = "server is already running";

interface ConnectionListener {
  event: string;
  handler: (...args: any[]) => void;
}

interface ConnectionState {
  environment: Environment;
  listeners: ConnectionListener[];
}

export function createNodeApp(registry: ServerRegistry) {
  // Per-connection listener bookkeeping, keyed by the connection's own Elysia
  // context object (stable across open/message/close for a given socket, and
  // distinct per connection). Kept out of `ws.data` itself so we don't need to
  // widen or cast Elysia's generated context type.
  const connections = new WeakMap<object, ConnectionState>();

  return new Elysia()
    .post("/servers/:identifier/start", async ({ params }) => {
      const environment = await registry.getOrCreateEnvironment(params.identifier);
      if (!environment) return status(404, { error: "server definition not found" });
      if (await environment.isRunning()) {
        return status(409, { error: ALREADY_RUNNING_MESSAGE });
      }
      const definition = await registry.loadDefinition(params.identifier);
      const cwd = registry.getServerDir(params.identifier);
      await mkdir(cwd, { recursive: true });
      try {
        await environment.start({
          command: definition!.execution.command,
          cwd,
        });
      } catch (error) {
        if (error instanceof EnvironmentBusyError) {
          return status(409, { error: error.message });
        }
        throw error;
      }
      return { accepted: true };
    })
    .post("/servers/:identifier/stop", async ({ params }) => {
      const environment = await registry.getOrCreateEnvironment(params.identifier);
      if (!environment) return status(404, { error: "server definition not found" });
      const definition = await registry.loadDefinition(params.identifier);
      await environment.stop({ stopCommand: definition?.execution.stopCommand });
      return { accepted: true };
    })
    .get("/servers/:identifier/status", async ({ params }) => {
      const environment = await registry.getOrCreateEnvironment(params.identifier);
      if (!environment) return status(404, { error: "server definition not found" });
      return { running: await environment.isRunning() };
    })
    .ws("/servers/:identifier/socket", {
      query: t.Object({
        console: t.Optional(t.String()),
        stats: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
      async open(ws) {
        const environment = await registry.getOrCreateEnvironment(ws.data.params.identifier);
        if (!environment) {
          ws.close();
          return;
        }
        // The registry lookup above awaits across a tick in which the client
        // can disconnect. If that happens, Elysia/Bun already invoked `close`
        // for this socket - it found no entry in `connections` (we hadn't set
        // one yet) and did nothing, and `close` will never fire again for
        // this connection. Registering listeners now would leak them
        // permanently, since nothing would ever remove them. `ws.readyState`
        // reflects the real underlying connection state (see
        // ElysiaWS#readyState -> raw.readyState), so bail out here instead of
        // subscribing to anything.
        if (ws.readyState !== WebSocket.OPEN) return;
        const listeners: ConnectionListener[] = [];
        if (ws.data.query.console) {
          const handler = (data: string) => ws.send({ type: "console", data });
          environment.on("console", handler);
          listeners.push({ event: "console", handler });
        }
        if (ws.data.query.stats) {
          const handler = (data: unknown) => ws.send({ type: "stat", data });
          environment.on("stat", handler);
          listeners.push({ event: "stat", handler });
        }
        if (ws.data.query.status) {
          const handler = (data: unknown) => ws.send({ type: "status", data });
          environment.on("status", handler);
          listeners.push({ event: "status", handler });
        }
        connections.set(ws.data, { environment, listeners });
      },
      close(ws) {
        const state = connections.get(ws.data);
        if (!state) return;
        for (const { event, handler } of state.listeners) {
          state.environment.off(event, handler);
        }
        connections.delete(ws.data);
      },
    });
}

export type NodeApp = ReturnType<typeof createNodeApp>;
