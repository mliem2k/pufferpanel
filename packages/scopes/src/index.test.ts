import { describe, expect, test } from "bun:test";
import { SCOPES, containsScope } from "./index";

describe("containsScope", () => {
  test("admin scope grants everything", () => {
    expect(containsScope(["admin"], SCOPES.SERVER_START, "mliem")).toBe(true);
  });

  test("server.admin grants any server-scoped permission for that server", () => {
    expect(containsScope(["server.admin"], SCOPES.SERVER_CONSOLE, "mliem")).toBe(true);
  });

  test("server.admin does not grant non-server scopes", () => {
    expect(containsScope(["server.admin"], SCOPES.NODES_EDIT)).toBe(false);
  });

  test("exact scope match grants access", () => {
    expect(containsScope(["server.start"], SCOPES.SERVER_START, "mliem")).toBe(true);
  });

  test("missing scope denies access", () => {
    expect(containsScope(["server.view"], SCOPES.SERVER_START, "mliem")).toBe(false);
  });
});
