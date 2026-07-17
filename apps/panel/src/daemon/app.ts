import { mkdir } from "node:fs/promises";
import { Elysia, status, t } from "elysia";
import type { ServerRegistry } from "./registry";

export function createNodeApp(registry: ServerRegistry) {
  return new Elysia()
    .post("/servers/:identifier/start", async ({ params }) => {
      const environment = await registry.getOrCreateEnvironment(params.identifier);
      if (!environment) return status(404, { error: "server definition not found" });
      const definition = await registry.loadDefinition(params.identifier);
      const cwd = registry.getServerDir(params.identifier);
      await mkdir(cwd, { recursive: true });
      await environment.start({
        command: definition!.execution.command,
        cwd,
      });
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
        if (ws.data.query.console) {
          environment.on("console", (data: string) => ws.send({ type: "console", data }));
        }
        if (ws.data.query.stats) {
          environment.on("stat", (data: unknown) => ws.send({ type: "stat", data }));
        }
        if (ws.data.query.status) {
          environment.on("status", (data: unknown) => ws.send({ type: "status", data }));
        }
      },
    });
}

export type NodeApp = ReturnType<typeof createNodeApp>;
