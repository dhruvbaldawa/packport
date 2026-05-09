// ABOUTME: Verifies the packport check primitive and CLI wrapper.
// ABOUTME: Covers success and failure output without making skills run logic themselves.

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { checkPackRepository, formatDiagnostics } from "../src/core/check";
import { runCli } from "../src/cli";

describe("checkPackRepository", () => {
  test("returns ok for a valid convention-discovered pack", async () => {
    const rootPath = await createValidPackRepository();

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(formatDiagnostics(result.diagnostics)).toBe("No packport issues found.");
  });

  test("returns not ok for error diagnostics", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-check-"));
    await mkdir(join(rootPath, "packs/essentials/commands/commit"), { recursive: true });
    await writeFile(
      join(rootPath, "packs/essentials/PACK.md"),
      `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
    );

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(formatDiagnostics(result.diagnostics)).toContain("ERROR missing-payload");
  });

  test("keeps warning-only diagnostics successful", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-check-"));
    await mkdir(join(rootPath, "packs/essentials/commands/commit"), { recursive: true });
    await writeFile(
      join(rootPath, "packs/essentials/PACK.md"),
      `Name: Essentials
Version: 1.0.0
Description: Core workflows.

# Essentials

## Unexpected

- still prose
`,
    );
    await writeFile(join(rootPath, "packs/essentials/commands/commit/COMMAND.md"), "# Commit\n");

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(true);
    expect(formatDiagnostics(result.diagnostics)).toContain("WARNING unknown-section");
  });
});

describe("runCli", () => {
  test("runs check and returns stdout", async () => {
    const rootPath = await createValidPackRepository();

    const result = await runCli(["check", rootPath]);

    expect(result).toEqual({ exitCode: 0, stdout: "No packport issues found." });
  });

  test("returns nonzero for failed checks", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-check-"));

    const result = await runCli(["check", rootPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("ERROR missing-packs-directory");
  });

  test("reports unknown commands", async () => {
    const result = await runCli(["wat"]);

    expect(result).toEqual({
      exitCode: 1,
      stderr: "Unknown command 'wat'.\nUsage: packport check [root]",
    });
  });
});

/** Creates a valid temporary pack repository for check and CLI tests. */
async function createValidPackRepository(): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), "packport-check-"));
  await mkdir(join(rootPath, "packs/essentials/commands/commit"), { recursive: true });
  await writeFile(
    join(rootPath, "packs/essentials/PACK.md"),
    `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
  );
  await writeFile(join(rootPath, "packs/essentials/commands/commit/COMMAND.md"), "# Commit\n");

  return rootPath;
}
