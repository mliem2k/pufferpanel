import { describe, expect, test } from "bun:test";
import { CORE_PACKAGE_VERSION } from "./index";

describe("core package", () => {
  test("exports a version marker", () => {
    expect(CORE_PACKAGE_VERSION).toBe("0.0.1");
  });
});
