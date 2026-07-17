export interface NodeClient {
  start(identifier: string): Promise<{ accepted: boolean }>;
  stop(identifier: string): Promise<{ accepted: boolean }>;
  status(identifier: string): Promise<{ running: boolean }>;
}

export class NodeClientNotImplementedError extends Error {
  constructor() {
    super("NodeClient is not implemented until Phase 2 (Daemon/Node)");
  }
}

class NotImplementedNodeClient implements NodeClient {
  async start(): Promise<{ accepted: boolean }> {
    throw new NodeClientNotImplementedError();
  }
  async stop(): Promise<{ accepted: boolean }> {
    throw new NodeClientNotImplementedError();
  }
  async status(): Promise<{ running: boolean }> {
    throw new NodeClientNotImplementedError();
  }
}

export function createNodeClient(_node: { id: number }): NodeClient {
  return new NotImplementedNodeClient();
}
