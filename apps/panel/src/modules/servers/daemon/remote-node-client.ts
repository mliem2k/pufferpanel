import { treaty } from "@elysiajs/eden";
import { NodeClientHttpError, type NodeClient } from "./node-client";
import { signPanelToken } from "../../auth/node-token";
import type { NodeApp } from "./node-app";

export interface RemoteNode {
  publicHost: string;
  publicPort: number;
  nodePrivateKeyPem: string;
}

interface TreatyResult<T> {
  data: T | null;
  error: { status: number; value: unknown } | null;
}

function unwrap<T>(result: TreatyResult<T>): T {
  if (result.error) {
    const value = result.error.value;
    const message =
      value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string"
        ? (value as { error: string }).error
        : `node request failed with status ${result.error.status}`;
    throw new NodeClientHttpError(result.error.status, message);
  }
  return result.data as T;
}

export function createRemoteNodeClient(node: RemoteNode): NodeClient {
  const api = treaty<NodeApp>(`http://${node.publicHost}:${node.publicPort}`);

  async function authHeaders(): Promise<{ authorization: string }> {
    const token = await signPanelToken(node.nodePrivateKeyPem);
    return { authorization: `Bearer ${token}` };
  }

  return {
    async start(identifier: string) {
      const headers = await authHeaders();
      const result = await api.servers({ identifier }).start.post(null, { headers });
      const data = unwrap(result);
      return { accepted: data.accepted === true };
    },
    async stop(identifier: string) {
      const headers = await authHeaders();
      const result = await api.servers({ identifier }).stop.post(null, { headers });
      const data = unwrap(result);
      return { accepted: data.accepted === true };
    },
    async status(identifier: string) {
      const headers = await authHeaders();
      const result = await api.servers({ identifier }).status.get({ headers });
      const data = unwrap(result);
      return { running: data.running === true };
    },
  };
}
