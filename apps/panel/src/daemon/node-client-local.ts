import type { NodeClient } from "@pufferpanel/services/node-client";
import type { NodeApp } from "./app";

export function createLocalNodeClient(nodeApp: NodeApp): NodeClient {
  async function call(path: string, method: string): Promise<Record<string, unknown>> {
    const response = await nodeApp.handle(new Request(`http://localhost${path}`, { method }));
    if (!response.ok) {
      throw new Error(`node request failed: ${method} ${path} returned ${response.status}`);
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
