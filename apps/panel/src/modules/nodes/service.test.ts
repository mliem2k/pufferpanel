import { describe, expect, test } from "bun:test";
import { createTestDb } from "../../db/test-helper";
import { createNode, listNodes, getNode, deleteNode } from "./service";

describe("node service", () => {
  test("createNode returns the generated secret once", async () => {
    const db = createTestDb();
    const node = await createNode(db, {
      name: "ubuntu-mliem",
      publicHost: "panel.mliem.com",
      privateHost: "127.0.0.1",
    });
    expect(node?.secret).toBeTruthy();
  });

  test("listNodes and getNode omit the secret", async () => {
    const db = createTestDb();
    const created = await createNode(db, {
      name: "ubuntu-mliem",
      publicHost: "panel.mliem.com",
      privateHost: "127.0.0.1",
    });
    const list = await listNodes(db);
    expect(list[0]).not.toHaveProperty("secret");
    const fetched = await getNode(db, created!.id);
    expect(fetched).not.toHaveProperty("secret");
  });

  test("deleteNode removes the row", async () => {
    const db = createTestDb();
    const created = await createNode(db, {
      name: "ubuntu-mliem",
      publicHost: "panel.mliem.com",
      privateHost: "127.0.0.1",
    });
    await deleteNode(db, created!.id);
    expect(await listNodes(db)).toHaveLength(0);
  });
});
