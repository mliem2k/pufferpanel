import { describe, expect, test } from "bun:test";
import { createNodeClient, NodeClientNotImplementedError } from "./node-client";

describe("NodeClient stub", () => {
  test("start throws NodeClientNotImplementedError until Phase 2", async () => {
    const client = createNodeClient({ id: 1 });
    await expect(client.start("mliem")).rejects.toBeInstanceOf(NodeClientNotImplementedError);
  });

  test("status throws NodeClientNotImplementedError until Phase 2", async () => {
    const client = createNodeClient({ id: 1 });
    await expect(client.status("mliem")).rejects.toBeInstanceOf(NodeClientNotImplementedError);
  });

  test("stop throws NodeClientNotImplementedError until Phase 2", async () => {
    const client = createNodeClient({ id: 1 });
    await expect(client.stop("mliem")).rejects.toBeInstanceOf(NodeClientNotImplementedError);
  });
});
