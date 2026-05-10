// ABOUTME: Verifies the initial packport source module can be imported and executed.
// ABOUTME: Provides a smoke test for the Bun test runner in the bootstrap commit.

import { describe, expect, test } from "bun:test";
import { describePackport, packageName, packageVersion } from "../src/index";

describe("packport bootstrap", () => {
  test("exports package metadata", () => {
    expect(packageName).toBe("packport");
    expect(packageVersion).toBe("0.0.0");
    expect(describePackport()).toContain("portable agent-pack");
  });
});
