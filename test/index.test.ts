// ABOUTME: Verifies the initial packport source module can be imported and executed.
// ABOUTME: Provides a smoke test for the Bun test runner in the bootstrap commit.

import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { describePackport, packageName, packageVersion } from "../src/index";

type PackageJson = {
  readonly bin?: Record<string, string>;
  readonly files?: readonly string[];
  readonly private?: boolean;
};

describe("packport bootstrap", () => {
  test("exports package metadata", () => {
    expect(packageName).toBe("packport");
    expect(packageVersion).toBe("0.0.0");
    expect(describePackport()).toContain("portable agent-pack");
  });

  test("exposes an installable Bun CLI bin", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as PackageJson;
    const binSource = await readFile("src/bin/packport.ts", "utf8");

    expect(packageJson.private).toBeUndefined();
    expect(packageJson.bin).toEqual({ packport: "./src/bin/packport.ts" });
    expect(packageJson.files).toEqual(["src", "packs", "docs", "README.md", "DESIGN.md"]);
    expect(binSource.startsWith("#!/usr/bin/env bun")).toBe(true);
  });
});
