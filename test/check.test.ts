// ABOUTME: Verifies the packport check primitive and CLI wrapper.
// ABOUTME: Covers success and failure output without making skills run logic themselves.

import { lstat, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
      `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
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
      `---
name: Essentials
version: 1.0.0
description: Core workflows.
---

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
  const usage =
    "Usage: packport check [root]\n       packport control-plugin claude <output> [source-root]\n       packport control-plugin claude configport <output> [source-root]\n       packport control-plugin claude-marketplace <repo-root> [package-root]\n       packport migrate-claude scan [root]\n       packport migrate-claude plan [root] [--exclude-plugin <name>]... [--exclude-asset <plugin/name>]...\n       packport migrate-claude write <source> <output> [--exclude-plugin <name>]... [--exclude-asset <plugin/name>]...";
  const claudeUsage = "Usage: packport claude generate <pack-root> [output-root]";
  const opencodeUsage =
    "Usage: packport opencode generate <pack-root> <output-root> [--include-control-packs]";
  const codexUsage =
    "Usage: packport codex generate <pack-root> [output-root] [--include-control-packs]";
  const configportUsage =
    "Usage: packport configport overlay put <state-root> <profile> <target> <pack> [--replace <from=to>]... [--file <path=content>]...\n       packport configport apply <state-root> <generated> <output> --profile <profile> --target <target> --pack <pack>\n       packport configport check <state-root> <generated> <output> --profile <profile> --target <target> --pack <pack>\n       packport configport instructions put <state-root> <profile> <target> <pack> <scope> --instruction <name>... [--answer <key=value>]...\n       packport configport instructions apply <state-root> <pack-root> <output> --profile <profile> --target <target> --pack <pack> --scope <scope>";

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
      stdout: `Generated Claude control plugin at ${outputPath} with 6 skill(s).`,
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

  test("treats exact packport control plugin argument as an output path", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(join(tmpdir(), "packport-cli-control-cwd-"));

    try {
      process.chdir(cwd);

      const result = await runCli(["control-plugin", "claude", "packport"]);

      expect(result).toEqual({
        exitCode: 0,
        stdout: "Generated Claude control plugin at packport with 6 skill(s).",
      });
      expect(
        JSON.parse(await readFile(join(cwd, "packport/.claude-plugin/plugin.json"), "utf8")),
      ).toMatchObject({
        name: "packport",
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("generates the Claude configport control plugin", async () => {
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-cli-control-")), "configport");

    const result = await runCli(["control-plugin", "claude", "configport", outputPath]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: `Generated Claude configport control plugin at ${outputPath} with 3 skill(s).`,
    });
    expect(
      JSON.parse(await readFile(join(outputPath, ".claude-plugin/plugin.json"), "utf8")),
    ).toMatchObject({
      name: "configport",
      version: "0.0.0",
    });
    expect(await readFile(join(outputPath, "skills/configure-pack/SKILL.md"), "utf8")).toStartWith(
      "---\nname: configure-pack",
    );
  });

  test("generates the Claude control marketplace", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-cli-control-marketplace-"));

    const result = await runCli(["control-plugin", "claude-marketplace", rootPath]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: `Generated Claude control marketplace at ${join(rootPath, ".claude-plugin/marketplace.json")} with 2 plugin(s).`,
    });
    expect(
      JSON.parse(await readFile(join(rootPath, ".claude-plugin/marketplace.json"), "utf8")),
    ).toEqual({
      name: "packport-local",
      owner: { name: "packport" },
      plugins: [
        {
          description: "packport control skills for portable agent packs",
          name: "packport",
          source: ".packs/claude/packport",
        },
        {
          description: "configport control skills for local agent-pack configuration",
          name: "configport",
          source: ".packs/claude/configport",
        },
      ],
    });
  });

  test("reports control plugin usage errors", async () => {
    const result = await runCli(["control-plugin", "opencode"]);

    expect(result).toEqual({
      exitCode: 1,
      stderr: usage,
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

  test("runs Claude migration dry-run plans", async () => {
    const rootPath = await createClaudePluginRepository();

    const result = await runCli(["migrate-claude", "plan", rootPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Claude migration plan:");
    expect(result.stdout).toContain("Files: 2");
    expect(result.stdout).toContain(
      `copy ${join(rootPath, "commands/commit.md")} -> packs/essentials/commands/commit/COMMAND.md`,
    );
  });

  test("runs Claude migration dry-run plans with plugin exclusions", async () => {
    const rootPath = await createClaudePluginRepository();

    const result = await runCli([
      "migrate-claude",
      "plan",
      rootPath,
      "--exclude-plugin",
      "essentials",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Plugins: 0");
    expect(result.stdout).toContain("Files: 0");
    expect(result.stdout).not.toContain("packs/essentials/PACK.md");
  });

  test("runs Claude migration dry-run plans with inline plugin exclusions", async () => {
    const rootPath = await createClaudePluginRepository();

    const result = await runCli([
      "migrate-claude",
      "plan",
      rootPath,
      "--exclude-plugin=essentials",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Plugins: 0");
    expect(result.stdout).toContain("Files: 0");
    expect(result.stdout).not.toContain("packs/essentials/PACK.md");
  });

  test("runs Claude migration dry-run plans with asset exclusions", async () => {
    const rootPath = await createClaudePluginRepository();

    const result = await runCli([
      "migrate-claude",
      "plan",
      rootPath,
      "--exclude-asset",
      "essentials/commit",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Assets: 0");
    expect(result.stdout).not.toContain("packs/essentials/commands/commit/COMMAND.md");
  });

  test("reports Claude migration plan option errors", async () => {
    const cases: readonly (readonly string[])[] = [
      ["migrate-claude", "plan", "--exclude-plugin"],
      ["migrate-claude", "plan", "--exclude-plugin", ""],
      ["migrate-claude", "plan", "--exclude-plugin="],
      ["migrate-claude", "plan", "--exclude-asset"],
      ["migrate-claude", "plan", "--exclude-asset="],
      ["migrate-claude", "plan", "--wat"],
      ["migrate-claude", "plan", "first", "second"],
    ];

    for (const args of cases) {
      const result = await runCli(args);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(usage);
    }
  });

  test("writes Claude migration output", async () => {
    const rootPath = await createClaudePluginRepository();
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-cli-write-")), "output");

    const result = await runCli(["migrate-claude", "write", rootPath, outputPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`Wrote 2 Claude migration file(s) to ${outputPath}.`);
    expect(
      await readFile(join(outputPath, "packs/essentials/commands/commit/COMMAND.md"), "utf8"),
    ).toBe("# Commit\n");
  });

  test("writes Claude migration output with asset exclusions", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-cli-write-source-"));
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-cli-write-")), "output");
    await mkdir(join(rootPath, ".claude-plugin"), { recursive: true });
    await mkdir(join(rootPath, "commands"), { recursive: true });
    await writeFile(
      join(rootPath, ".claude-plugin/plugin.json"),
      JSON.stringify({
        description: "Todoist workflows",
        name: "todoist",
        version: "1.0.0",
      }),
    );
    await writeFile(join(rootPath, "commands/commit.md"), "# Commit\n");
    await writeFile(join(rootPath, "commands/search.md"), "Use $TODOIST_API_TOKEN.\n");

    const result = await runCli([
      "migrate-claude",
      "write",
      rootPath,
      outputPath,
      "--exclude-asset",
      "todoist/search",
    ]);

    expect(result.exitCode).toBe(0);
    expect(
      await readFile(join(outputPath, "packs/todoist/commands/commit/COMMAND.md"), "utf8"),
    ).toBe("# Commit\n");
    await expect(
      readFile(join(outputPath, "packs/todoist/commands/search/COMMAND.md"), "utf8"),
    ).rejects.toThrow();
  });

  test("reports Claude migration write usage errors", async () => {
    const result = await runCli(["migrate-claude", "write", "only-source"]);

    expect(result).toEqual({
      exitCode: 1,
      stderr: `migrate-claude write requires source and output paths.\n${usage}`,
    });

    const optionResult = await runCli(["migrate-claude", "write", "source", "output", "--wat"]);

    expect(optionResult).toEqual({
      exitCode: 1,
      stderr: `Unknown migrate-claude option '--wat'.\n${usage}`,
    });
  });

  test("generates Claude output and marketplace metadata", async () => {
    const rootPath = await createValidPackRepository();

    const result = await runCli(["claude", "generate", rootPath]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: `Generated Claude output at ${join(rootPath, ".packs/claude")} with 1 plugin(s), 1 command(s), 0 agent(s), 0 skill(s), and 1 marketplace entry(s).`,
    });
    expect(
      await readFile(join(rootPath, ".packs/claude/essentials/commands/commit.md"), "utf8"),
    ).toBe("# Commit\n");
    expect(
      JSON.parse(await readFile(join(rootPath, ".claude-plugin/marketplace.json"), "utf8")),
    ).toMatchObject({
      plugins: [
        {
          name: "essentials",
          source: ".packs/claude/essentials",
        },
      ],
    });
  });

  test("generates Claude output with an explicit repo-local output root", async () => {
    const rootPath = await createValidPackRepository();
    const outputPath = join(rootPath, ".packs/claude");

    const result = await runCli(["claude", "generate", rootPath, outputPath]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: `Generated Claude output at ${outputPath} with 1 plugin(s), 1 command(s), 0 agent(s), 0 skill(s), and 1 marketplace entry(s).`,
    });
    expect(await readFile(join(outputPath, "essentials/commands/commit.md"), "utf8")).toBe(
      "# Commit\n",
    );
  });

  test("reports Claude generation usage errors", async () => {
    const missingRoot = await runCli(["claude", "generate"]);
    const wrongSubcommand = await runCli(["claude", "scan", "root"]);
    const tooManyArgs = await runCli(["claude", "generate", "root", "output", "extra"]);

    expect(missingRoot).toEqual({ exitCode: 1, stderr: claudeUsage });
    expect(wrongSubcommand).toEqual({ exitCode: 1, stderr: claudeUsage });
    expect(tooManyArgs).toEqual({ exitCode: 1, stderr: claudeUsage });
  });

  test("returns Claude generation diagnostics for invalid output roots", async () => {
    const rootPath = await createValidPackRepository();
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-cli-claude-output-")), "claude");

    const result = await runCli(["claude", "generate", rootPath, outputPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `Generated Claude output at ${outputPath} with 0 plugin(s), 0 command(s), 0 agent(s), 0 skill(s), and 0 marketplace entry(s).`,
    );
    expect(result.stdout).toContain("ERROR invalid-claude-output-root");
    await expect(lstat(join(outputPath, "essentials/commands/commit.md"))).rejects.toThrow();
  });

  test("generates OpenCode output", async () => {
    const rootPath = await createValidPackRepository();
    const outputPath = join(rootPath, ".packs/opencode");

    const result = await runCli(["opencode", "generate", rootPath, outputPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `Generated OpenCode output at ${outputPath} with 1 command(s), 0 agent(s), and 0 skill(s).`,
    );
    expect(await readFile(join(outputPath, ".opencode/commands/commit.md"), "utf8")).toBe(
      ["---", 'description: "commit command"', "---", "", "# Commit", ""].join("\n"),
    );
  });

  test("accepts explicit control-pack inclusion for OpenCode dogfood generation", async () => {
    const rootPath = await createValidPackRepositoryWithControlPack();
    const outputPath = join(rootPath, ".packs/opencode");

    const result = await runCli([
      "opencode",
      "generate",
      rootPath,
      outputPath,
      "--include-control-packs",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `Generated OpenCode output at ${outputPath} with 1 command(s), 0 agent(s), and 1 skill(s).`,
    );
    expect(
      await readFile(join(outputPath, ".opencode/skills/check-pack/SKILL.md"), "utf8"),
    ).toContain("name: check-pack");
  });

  test("reports OpenCode generation usage errors", async () => {
    const result = await runCli(["opencode", "generate", "only-root"]);
    const unknownOption = await runCli([
      "opencode",
      "generate",
      "root",
      "output",
      "--include-control-packs=false",
    ]);

    expect(result).toEqual({ exitCode: 1, stderr: opencodeUsage });
    expect(unknownOption).toEqual({ exitCode: 1, stderr: opencodeUsage });
  });

  test("generates Codex output and marketplace metadata", async () => {
    const rootPath = await createValidPackRepository();

    const result = await runCli(["codex", "generate", rootPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `Generated Codex output at ${join(rootPath, ".packs/codex")} with 1 plugin(s), 1 skill(s), 0 agent(s), and 1 marketplace entry(s).`,
    );
    expect(
      JSON.parse(
        await readFile(join(rootPath, ".packs/codex/essentials/.codex-plugin/plugin.json"), "utf8"),
      ),
    ).toMatchObject({
      name: "essentials",
      version: "1.0.0",
    });
    expect(
      await readFile(join(rootPath, ".packs/codex/essentials/skills/commit/SKILL.md"), "utf8"),
    ).toContain("name: commit");
    expect(
      JSON.parse(await readFile(join(rootPath, ".agents/plugins/marketplace.json"), "utf8")),
    ).toMatchObject({
      plugins: [
        {
          name: "essentials",
          source: { path: "./.packs/codex/essentials", source: "local" },
        },
      ],
    });
  });

  test("accepts explicit control-pack inclusion for Codex dogfood generation", async () => {
    const rootPath = await createValidPackRepositoryWithControlPack();

    const result = await runCli(["codex", "generate", rootPath, "--include-control-packs"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `Generated Codex output at ${join(rootPath, ".packs/codex")} with 2 plugin(s), 2 skill(s), 0 agent(s), and 2 marketplace entry(s).`,
    );
    expect(
      await readFile(
        join(rootPath, ".packs/codex/packport-control/skills/check-pack/SKILL.md"),
        "utf8",
      ),
    ).toContain("name: check-pack");
    expect(
      JSON.parse(
        await readFile(join(rootPath, ".agents/plugins/marketplace.json"), "utf8"),
      ).plugins.map((plugin: { name: string }) => plugin.name),
    ).toEqual(["essentials", "packport-control"]);
  });

  test("reports Codex generation usage errors", async () => {
    const result = await runCli(["codex", "generate"]);
    const tooManyPaths = await runCli(["codex", "generate", "root", "output", "extra"]);
    const unknownOption = await runCli(["codex", "generate", "root", "--wat"]);

    expect(result).toEqual({ exitCode: 1, stderr: codexUsage });
    expect(tooManyPaths).toEqual({ exitCode: 1, stderr: codexUsage });
    expect(unknownOption).toEqual({ exitCode: 1, stderr: codexUsage });
  });

  test("stores and applies configport overlays", async () => {
    const stateRootPath = await mkdtemp(join(tmpdir(), "packport-cli-configport-state-"));
    const generatedPath = await mkdtemp(join(tmpdir(), "packport-cli-configport-generated-"));
    const outputPath = await mkdtemp(join(tmpdir(), "packport-cli-configport-output-"));
    await mkdir(join(generatedPath, "commands/search"), { recursive: true });
    await writeFile(join(generatedPath, "commands/search/COMMAND.md"), "Dhruv searches.\n");

    const putResult = await runCli([
      "configport",
      "overlay",
      "put",
      stateRootPath,
      "personal",
      "opencode",
      "todoist",
      "--replace",
      "Dhruv=Avery",
      "--file",
      ".opencode/local.conf=theme = system\n",
    ]);

    expect(putResult).toEqual({
      exitCode: 0,
      stdout: `Stored configport overlay personal/opencode/todoist at ${join(stateRootPath, "configport.json")} with 1 replacement(s) and 1 file overlay(s).`,
    });

    const applyResult = await runCli([
      "configport",
      "apply",
      stateRootPath,
      generatedPath,
      outputPath,
      "--profile",
      "personal",
      "--target",
      "opencode",
      "--pack",
      "todoist",
    ]);

    expect(applyResult).toEqual({
      exitCode: 0,
      stdout: `Applied configport overlay personal/opencode/todoist to ${outputPath} with 2 file(s).`,
    });
    expect(await readFile(join(outputPath, "commands/search/COMMAND.md"), "utf8")).toBe(
      "Avery searches.\n",
    );
    expect(await readFile(join(outputPath, ".opencode/local.conf"), "utf8")).toBe(
      "theme = system\n",
    );

    const cleanCheckResult = await runCli([
      "configport",
      "check",
      stateRootPath,
      generatedPath,
      outputPath,
      "--profile",
      "personal",
      "--target",
      "opencode",
      "--pack",
      "todoist",
    ]);

    expect(cleanCheckResult).toEqual({
      exitCode: 0,
      stdout: `Checked configport overlay personal/opencode/todoist at ${outputPath} with 2 file(s).`,
    });

    await writeFile(join(outputPath, "commands/search/COMMAND.md"), "manual edit\n");
    const driftCheckResult = await runCli([
      "configport",
      "check",
      stateRootPath,
      generatedPath,
      outputPath,
      "--profile",
      "personal",
      "--target",
      "opencode",
      "--pack",
      "todoist",
    ]);

    expect(driftCheckResult.exitCode).toBe(1);
    expect(driftCheckResult.stdout).toContain(
      `Checked configport overlay personal/opencode/todoist at ${outputPath} with 2 file(s).`,
    );
    expect(driftCheckResult.stdout).toContain("ERROR configport-output-drift");
  });

  test("stores and materializes configport instruction selections", async () => {
    const stateRootPath = await mkdtemp(join(tmpdir(), "packport-cli-configport-state-"));
    const packRootPath = await mkdtemp(join(tmpdir(), "packport-cli-configport-packs-"));
    const outputPath = await mkdtemp(join(tmpdir(), "packport-cli-configport-output-"));
    await mkdir(join(packRootPath, "packs/essentials/instructions/repo-workflow"), {
      recursive: true,
    });
    await writeFile(
      join(packRootPath, "packs/essentials/PACK.md"),
      `---
name: Essentials
version: 1.0.0
description: Core workflows.
---

## Configuration

- {{config.review_voice}} controls review tone.
`,
    );
    await writeFile(
      join(packRootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      "Project voice: {{config.review_voice}}.\n",
    );

    const putResult = await runCli([
      "configport",
      "instructions",
      "put",
      stateRootPath,
      "personal",
      "opencode",
      "essentials",
      "project",
      "--instruction",
      "repo-workflow",
      "--answer",
      "review_voice=direct",
    ]);

    expect(putResult).toEqual({
      exitCode: 0,
      stdout: `Stored configport instruction selection personal/opencode/essentials/project at ${join(stateRootPath, "configport.json")} with 1 instruction(s) and 1 answer(s).`,
    });

    const applyResult = await runCli([
      "configport",
      "instructions",
      "apply",
      stateRootPath,
      packRootPath,
      outputPath,
      "--profile",
      "personal",
      "--target",
      "opencode",
      "--pack",
      "essentials",
      "--scope",
      "project",
    ]);

    expect(applyResult).toEqual({
      exitCode: 0,
      stdout: `Materialized configport instructions personal/opencode/essentials/project to ${outputPath} with 1 file(s).`,
    });
    expect(await readFile(join(outputPath, "AGENTS.md"), "utf8")).toContain(
      "Project voice: direct.",
    );
  });

  test("reports configport instruction put usage errors without writing state", async () => {
    const stateRootPath = await mkdtemp(join(tmpdir(), "packport-cli-configport-state-"));

    const missingInstruction = await runCli([
      "configport",
      "instructions",
      "put",
      stateRootPath,
      "personal",
      "codex",
      "essentials",
      "project",
    ]);
    const invalidTarget = await runCli([
      "configport",
      "instructions",
      "put",
      stateRootPath,
      "personal",
      "bad-target",
      "essentials",
      "project",
      "--instruction",
      "repo-workflow",
    ]);
    const invalidScope = await runCli([
      "configport",
      "instructions",
      "put",
      stateRootPath,
      "personal",
      "codex",
      "essentials",
      "bad-scope",
      "--instruction",
      "repo-workflow",
    ]);
    const unknownOption = await runCli([
      "configport",
      "instructions",
      "put",
      stateRootPath,
      "personal",
      "codex",
      "essentials",
      "project",
      "--wat",
    ]);

    expect(missingInstruction.exitCode).toBe(1);
    expect(missingInstruction.stdout).toContain("ERROR missing-configport-instructions");
    expect(invalidTarget).toEqual({
      exitCode: 1,
      stderr: `configport instructions put target must be claude, codex, or opencode.\n${configportUsage}`,
    });
    expect(invalidScope).toEqual({
      exitCode: 1,
      stderr: `configport instructions put scope must be project or user.\n${configportUsage}`,
    });
    expect(unknownOption).toEqual({
      exitCode: 1,
      stderr: `Unknown configport instructions put option '--wat'.\n${configportUsage}`,
    });
    await expect(lstat(join(stateRootPath, "configport.json"))).rejects.toThrow();
  });

  test("reports configport instruction apply usage errors without writing output", async () => {
    const stateRootPath = await mkdtemp(join(tmpdir(), "packport-cli-configport-state-"));
    const packRootPath = await mkdtemp(join(tmpdir(), "packport-cli-configport-packs-"));
    const outputPath = await mkdtemp(join(tmpdir(), "packport-cli-configport-output-"));

    const missingFlags = await runCli([
      "configport",
      "instructions",
      "apply",
      stateRootPath,
      packRootPath,
      outputPath,
    ]);
    const invalidTarget = await runCli([
      "configport",
      "instructions",
      "apply",
      stateRootPath,
      packRootPath,
      outputPath,
      "--profile",
      "personal",
      "--target",
      "bad-target",
      "--pack",
      "essentials",
      "--scope",
      "project",
    ]);
    const unknownOption = await runCli([
      "configport",
      "instructions",
      "apply",
      stateRootPath,
      packRootPath,
      outputPath,
      "--profile",
      "personal",
      "--target",
      "codex",
      "--pack",
      "essentials",
      "--scope",
      "project",
      "--wat",
    ]);

    expect(missingFlags).toEqual({
      exitCode: 1,
      stderr: `configport instructions apply requires --profile, --target, --pack, and --scope.\n${configportUsage}`,
    });
    expect(invalidTarget).toEqual({
      exitCode: 1,
      stderr: `configport instructions apply target must be claude, codex, or opencode.\n${configportUsage}`,
    });
    expect(unknownOption).toEqual({
      exitCode: 1,
      stderr: `Unknown configport instructions apply option '--wat'.\n${configportUsage}`,
    });
    await expect(lstat(join(outputPath, "AGENTS.md"))).rejects.toThrow();
  });

  test("reports configport usage errors", async () => {
    const result = await runCli(["configport", "apply", "state", "generated", "output"]);

    expect(result).toEqual({
      exitCode: 1,
      stderr: `configport apply requires --profile, --target, and --pack.\n${configportUsage}`,
    });
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
      stderr: usage,
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
      stderr: `Unknown command 'wat'.\n${usage}\n${claudeUsage}\n${opencodeUsage}\n${codexUsage}\n${configportUsage}`,
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
    `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
  );
  await writeFile(join(rootPath, "packs/essentials/commands/commit/COMMAND.md"), "# Commit\n");

  return rootPath;
}

/** Creates a valid temporary pack repository with one built-in control pack. */
async function createValidPackRepositoryWithControlPack(): Promise<string> {
  const rootPath = await createValidPackRepository();
  await mkdir(join(rootPath, "packs/packport-control/skills/check-pack"), { recursive: true });
  await writeFile(
    join(rootPath, "packs/packport-control/PACK.md"),
    `---
name: packport-control
version: 0.0.0
description: Control workflows.
---
`,
  );
  await writeFile(join(rootPath, "packs/packport-control/skills/check-pack/SKILL.md"), "# Check\n");

  return rootPath;
}
