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

// Thrown by real (non-stub) NodeClient implementations - e.g. the local,
// in-process daemon client - when the underlying node request fails with a
// non-2xx HTTP status. Carries that status through so callers (the /servers
// routes) can reflect it back to the Panel API caller instead of collapsing
// every failure into a generic 500.
export class NodeClientHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
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
