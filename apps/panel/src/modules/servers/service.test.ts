import { describe, expect, test } from "bun:test";
import { createTestDb } from "../../db/test-helper";
import { createNode } from "../nodes/service";
import { createServer, listServers, getServerByIdentifier, deleteServer } from "./service";

describe("server service", () => {
  test("creates a server tied to a node", async () => {
    const db = createTestDb();
    const node = await createNode(db, {
      name: "ubuntu-mliem",
      publicHost: "panel.mliem.com",
      privateHost: "127.0.0.1",
    });
    const server = await createServer(db, {
      identifier: "mliem",
      name: "mliem",
      nodeId: node!.id,
      ip: "0.0.0.0",
      port: 25565,
      type: "minecraft-purpur",
    });
    expect(server?.identifier).toBe("mliem");
  });

  test("listServers and getServerByIdentifier return the row", async () => {
    const db = createTestDb();
    const node = await createNode(db, {
      name: "ubuntu-mliem",
      publicHost: "panel.mliem.com",
      privateHost: "127.0.0.1",
    });
    await createServer(db, {
      identifier: "mliem",
      name: "mliem",
      nodeId: node!.id,
      ip: "0.0.0.0",
      port: 25565,
      type: "minecraft-purpur",
    });
    expect(await listServers(db)).toHaveLength(1);
    expect((await getServerByIdentifier(db, "mliem"))?.type).toBe("minecraft-purpur");
  });

  test("deleteServer removes the row", async () => {
    const db = createTestDb();
    const node = await createNode(db, {
      name: "ubuntu-mliem",
      publicHost: "panel.mliem.com",
      privateHost: "127.0.0.1",
    });
    await createServer(db, {
      identifier: "mliem",
      name: "mliem",
      nodeId: node!.id,
      ip: "0.0.0.0",
      port: 25565,
      type: "minecraft-purpur",
    });
    await deleteServer(db, "mliem");
    expect(await listServers(db)).toHaveLength(0);
  });
});
