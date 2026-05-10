// ABOUTME: Verifies the packport check primitive and CLI wrapper.
// ABOUTME: Covers success and failure output without making skills run logic themselves.

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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

  test("generates the Claude control plugin", async () => {
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-cli-control-")), "packport");

    const result = await runCli(["control-plugin", "claude", outputPath]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: `Generated Claude control plugin at ${outputPath} with 2 skill(s).`,
    });
    expect(
      JSON.parse(await readFile(join(outputPath, ".claude-plugin/plugin.json"), "utf8")),
    ).toMatchObject({
      name: "packport",
      version: "0.0.0",
    });
    expect(await readFile(join(outputPath, "skills/check-pack/SKILL.md"), "utf8")).toStartWith(
      "---\nname: check-pack",
    );
  });

  test("reports control plugin usage errors", async () => {
    const result = await runCli(["control-plugin", "opencode"]);

    expect(result).toEqual({
      exitCode: 1,
      stderr:
        "Usage: packport check [root]\n       packport control-plugin claude <output> [source-root]\n       packport migrate-claude scan [root]",
    });
  });

  test("runs Claude migration scans", async () => {
    const rootPath = await createClaudePluginRepository();

    const result = await runCli(["migrate-claude", "scan", rootPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Claude migration scan:");
    expect(result.stdout).toContain("Plugins: 1");
    expect(result.stdout).toContain("command essentials/commit pack-candidate commands/commit.md");
  });

  test("returns nonzero for Claude migration scan errors", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-claude-scan-"));

    const result = await runCli(["migrate-claude", "scan", rootPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("ERROR missing-claude-source");
  });

  test("reports Claude migration usage errors", async () => {
    const result = await runCli(["migrate-claude"]);

    expect(result).toEqual({
      exitCode: 1,
      stderr:
        "Usage: packport check [root]\n       packport control-plugin claude <output> [source-root]\n       packport migrate-claude scan [root]",
    });
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
      stderr:
        "Unknown command 'wat'.\nUsage: packport check [root]\n       packport control-plugin claude <output> [source-root]\n       packport migrate-claude scan [root]",
    });
  });
});

/** Creates a valid temporary Claude plugin repository for CLI scan tests. */
async function createClaudePluginRepository(): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), "packport-claude-scan-"));
  await mkdir(join(rootPath, ".claude-plugin"), { recursive: true });
  await mkdir(join(rootPath, "commands"), { recursive: true });
  await writeFile(
    join(rootPath, ".claude-plugin/plugin.json"),
    JSON.stringify({ description: "Essential workflows", name: "essentials", version: "1.0.0" }),
  );
  await writeFile(join(rootPath, "commands/commit.md"), "# Commit\n");

  return rootPath;
}

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
