import { NodeClientHttpError, type NodeClient } from "./node-client";
import type { NodeApp } from "./node-app";

export function createLocalNodeClient(nodeApp: NodeApp): NodeClient {
  async function call(path: string, method: string): Promise<Record<string, unknown>> {
    const response = await nodeApp.handle(new Request(`http://localhost${path}`, { method }));
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message =
        (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : undefined) ?? `node request failed: ${method} ${path} returned ${response.status}`;
      throw new NodeClientHttpError(response.status, message);
    }
    return response.json();
  }

  return {
    async start(identifier: string) {
      const result = await call(`/servers/${identifier}/start`, "POST");
      return { accepted: result.accepted === true };
    },
    async stop(identifier: string) {
      const result = await call(`/servers/${identifier}/stop`, "POST");
      return { accepted: result.accepted === true };
    },
    async status(identifier: string) {
      const result = await call(`/servers/${identifier}/status`, "GET");
      return { running: result.running === true };
    },
  };
}
