// ABOUTME: Verifies the packport check primitive and CLI wrapper.
// ABOUTME: Covers success and failure output without making skills run logic themselves.

import { lstat, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { checkPackRepository, formatDiagnostics } from "../src/core/check";
import { generateClaudeOutput } from "../src/core/claude";
import { generateCodexOutput } from "../src/core/codex";
import {
  generateClaudeControlMarketplace,
  generateClaudeControlPlugin,
} from "../src/core/control-plugin";
import { discoverPackRepository } from "../src/core/discovery";
import { createPackLock, readPackLock, writePackLock } from "../src/core/lockfile";
import { generateOpenCodeOutput } from "../src/core/opencode";
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

  test("returns ok when generated OpenCode output matches current generators", async () => {
    const rootPath = await createValidPackRepository();

    await generateOpenCodeOutput(rootPath, join(rootPath, ".packs/opencode"));

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  test("reports generated output drift even when stale output hashes are locked", async () => {
    const rootPath = await createValidPackRepository();
    const generatedPath = join(rootPath, ".packs/opencode/essentials/.opencode/commands/commit.md");
    await generateOpenCodeOutput(rootPath, join(rootPath, ".packs/opencode"));
    await writeFile(generatedPath, "# Manually edited generated command\n");
    await refreshLockFromCurrentGeneratedOutputs(rootPath);

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("output-drift");
    expect(result.diagnostics).toContainEqual({
      code: "generated-output-drift",
      message: "Generated output differs from current generator output.",
      path: generatedPath,
      severity: "error",
    });
    expect(result.diagnostics).toContainEqual({
      code: "generated-lock-drift",
      message: "pack.lock.yaml differs from the lockfile produced by current generators.",
      path: join(rootPath, "pack.lock.yaml"),
      severity: "error",
    });
  });

  test("reports Claude generated output drift even when stale output hashes are locked", async () => {
    const rootPath = await createValidPackRepository();
    const generatedPath = join(rootPath, ".packs/claude/essentials/commands/commit.md");
    await generateClaudeOutput(rootPath);
    await writeFile(generatedPath, "# Manually edited Claude command\n");
    await refreshLockFromCurrentGeneratedOutputs(rootPath);

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "generated-output-drift",
      message: "Generated output differs from current generator output.",
      path: generatedPath,
      severity: "error",
    });
  });

  test("reports Codex generated output drift even when stale output hashes are locked", async () => {
    const rootPath = await createValidPackRepository();
    const generatedPath = join(rootPath, ".packs/codex/essentials/skills/commit/SKILL.md");
    await generateCodexOutput(rootPath);
    await writeFile(generatedPath, "# Manually edited Codex skill\n");
    await refreshLockFromCurrentGeneratedOutputs(rootPath);

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "generated-output-drift",
      message: "Generated output differs from current generator output.",
      path: generatedPath,
      severity: "error",
    });
  });

  test("does not report Codex config drift for unmanaged config edits", async () => {
    const rootPath = await createValidPackRepository();
    await writeFile(
      join(rootPath, "packs/essentials/.mcp.json"),
      JSON.stringify({
        mcpServers: {
          api: {
            headers: { Authorization: "Bearer " + "$" + "{API_TOKEN}" },
            url: "https://api.example.test/mcp",
          },
        },
      }),
    );
    await mkdir(join(rootPath, ".codex"), { recursive: true });
    await writeFile(join(rootPath, ".codex/config.toml"), 'model = "gpt-5"\n');
    await generateCodexOutput(rootPath);
    await writeFile(
      join(rootPath, ".codex/config.toml"),
      [
        'model = "gpt-5.5"',
        "",
        "# packport-managed-codex-mcp:start",
        '[mcp_servers."api"]',
        'url = "https://api.example.test/mcp"',
        'bearer_token_env_var = "API_TOKEN"',
        "enabled = true",
        "# packport-managed-codex-mcp:end",
        "",
      ].join("\n"),
    );

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  test("returns ok for a repo with only Claude control plugin output locked", async () => {
    const rootPath = await createControlPackRepository();

    await generateClaudeControlPlugin(rootPath, join(rootPath, ".packs/claude/packport"), "0.0.0");

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  test("reports Claude control plugin drift even when stale output hashes are locked", async () => {
    const rootPath = await createControlPackRepository();
    const generatedPath = join(rootPath, ".packs/claude/packport/skills/check-pack/SKILL.md");
    await generateClaudeControlPlugin(rootPath, join(rootPath, ".packs/claude/packport"), "0.0.0");
    await writeFile(generatedPath, "# Manually edited control skill\n");
    await refreshLockFromCurrentGeneratedOutputs(rootPath);

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "generated-output-drift",
      message: "Generated output differs from current generator output.",
      path: generatedPath,
      severity: "error",
    });
    expect(result.diagnostics).toContainEqual({
      code: "generated-lock-drift",
      message: "pack.lock.yaml differs from the lockfile produced by current generators.",
      path: join(rootPath, "pack.lock.yaml"),
      severity: "error",
    });
  });

  test("reports Claude control marketplace drift even when stale output hashes are locked", async () => {
    const rootPath = await createFullControlPackRepository();
    const marketplacePath = join(rootPath, ".claude-plugin/marketplace.json");
    await generateClaudeControlPlugin(rootPath, join(rootPath, ".packs/claude/packport"), "0.0.0");
    await generateClaudeControlPlugin(
      rootPath,
      join(rootPath, ".packs/claude/configport"),
      "0.0.0",
      "configport",
    );
    await generateClaudeControlMarketplace(rootPath);
    await writeFile(
      marketplacePath,
      `${JSON.stringify({ name: "packport-local", owner: { name: "packport" }, plugins: [] }, null, 2)}\n`,
    );
    await refreshLockFromCurrentGeneratedOutputs(rootPath, [
      { kind: "marketplace", path: marketplacePath, target: "claude" },
    ]);

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "generated-output-drift",
      message: "Generated output differs from current generator output.",
      path: marketplacePath,
      severity: "error",
    });
    expect(result.diagnostics).toContainEqual({
      code: "generated-lock-drift",
      message: "pack.lock.yaml differs from the lockfile produced by current generators.",
      path: join(rootPath, "pack.lock.yaml"),
      severity: "error",
    });
  });

  test("reports generator replay diagnostics with repository paths", async () => {
    const rootPath = await createValidPackRepository();
    const configPath = join(rootPath, ".packs/opencode/essentials/opencode.json");
    await generateOpenCodeOutput(rootPath, join(rootPath, ".packs/opencode"));
    await writeFile(configPath, "{\n");
    await refreshLockFromCurrentGeneratedOutputs(rootPath);

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "invalid-opencode-config",
      message: "Existing opencode.json must contain valid JSON.",
      path: configPath,
      severity: "error",
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.path).join("\n")).not.toContain(
      "packport-generated-check",
    );
  });
});

describe("runCli", () => {
  const usage =
    "Usage: packport generate [root] [--target <claude|opencode|codex>]... [--no-configport]\n       Usage: packport install [root] [--target <claude|opencode|codex>]... [--dry-run] [--no-configport] [--codex-home <path>] [--agents-root <path>] [--claude-home <path>] [--opencode-config-root <path>]\n       packport check [root]\n       packport control-plugin claude <output> [source-root]\n       packport control-plugin claude configport <output> [source-root]\n       packport control-plugin claude-marketplace <repo-root> [package-root]\n       packport migrate-claude scan [root]\n       packport migrate-claude plan [root] [--accept-asset <plugin/name>]... [--exclude-plugin <name>]... [--exclude-asset <plugin/name>]...\n       packport migrate-claude write <source> <output> [--accept-asset <plugin/name>]... [--exclude-plugin <name>]... [--exclude-asset <plugin/name>]...";
  const generateUsage =
    "Usage: packport generate [root] [--target <claude|opencode|codex>]... [--no-configport]";
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

  test("runs Claude migration dry-run plans with asset acceptances", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-cli-plan-source-"));
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
    await writeFile(join(rootPath, "commands/search.md"), "Use $TODOIST_API_TOKEN.\n");

    const result = await runCli([
      "migrate-claude",
      "plan",
      rootPath,
      "--accept-asset",
      "todoist/search",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Questions: 0");
    expect(result.stdout).not.toContain("question pack-candidate todoist/search");
  });

  test("reports Claude migration plan option errors", async () => {
    const cases: readonly (readonly string[])[] = [
      ["migrate-claude", "plan", "--accept-asset"],
      ["migrate-claude", "plan", "--accept-asset="],
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

  test("writes Claude migration output with asset acceptances", async () => {
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
    await writeFile(join(rootPath, "commands/search.md"), "Use $TODOIST_API_TOKEN.\n");

    const result = await runCli([
      "migrate-claude",
      "write",
      rootPath,
      outputPath,
      "--accept-asset=todoist/search",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`Wrote 2 Claude migration file(s) to ${outputPath}.`);
    expect(
      await readFile(join(outputPath, "packs/todoist/commands/search/COMMAND.md"), "utf8"),
    ).toBe("Use $TODOIST_API_TOKEN.\n");
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

  test("generates all target output and marketplace metadata", async () => {
    const rootPath = await createValidPackRepository();

    const result = await runCli(["generate", rootPath]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        `Generated Claude output at ${join(rootPath, ".packs/claude")} with 1 plugin(s), 1 command(s), 0 agent(s), 0 skill(s), and 1 marketplace entry(s).`,
        `Generated OpenCode output at ${join(rootPath, ".packs/opencode")} with 1 package(s), 1 command(s), 0 agent(s), and 0 skill(s).`,
        `Generated Codex output at ${join(rootPath, ".packs/codex")} with 1 plugin(s), 1 skill(s), 0 agent(s), and 1 marketplace entry(s).`,
      ].join("\n"),
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
    expect(
      await readFile(
        join(rootPath, ".packs/opencode/essentials/.opencode/commands/commit.md"),
        "utf8",
      ),
    ).toBe(["---", 'description: "commit command"', "---", "", "# Commit", ""].join("\n"));
    expect(
      JSON.parse(
        await readFile(join(rootPath, ".packs/codex/essentials/.codex-plugin/plugin.json"), "utf8"),
      ),
    ).toMatchObject({
      name: "essentials",
      version: "1.0.0",
    });
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
    expect(
      new Set((await readPackLock(rootPath)).lock?.outputs.map((output) => output.target)),
    ).toEqual(new Set(["claude", "codex", "opencode"]));
  });

  test("generates only selected targets in stable order", async () => {
    const rootPath = await createValidPackRepository();

    const result = await runCli([
      "generate",
      rootPath,
      "--target",
      "codex",
      "--target",
      "claude",
      "--target=codex",
    ]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        `Generated Claude output at ${join(rootPath, ".packs/claude")} with 1 plugin(s), 1 command(s), 0 agent(s), 0 skill(s), and 1 marketplace entry(s).`,
        `Generated Codex output at ${join(rootPath, ".packs/codex")} with 1 plugin(s), 1 skill(s), 0 agent(s), and 1 marketplace entry(s).`,
      ].join("\n"),
    });
    expect(
      await readFile(join(rootPath, ".packs/claude/essentials/commands/commit.md"), "utf8"),
    ).toBe("# Commit\n");
    expect(
      await readFile(join(rootPath, ".packs/codex/essentials/skills/commit/SKILL.md"), "utf8"),
    ).toContain("name: commit");
    await expect(
      lstat(join(rootPath, ".packs/opencode/essentials/.opencode/commands/commit.md")),
    ).rejects.toThrow();
  });

  test("generates control packs as ordinary packs by default", async () => {
    const rootPath = await createValidPackRepositoryWithControlPack();

    const result = await runCli(["generate", rootPath, "--target", "opencode"]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: `Generated OpenCode output at ${join(rootPath, ".packs/opencode")} with 2 package(s), 1 command(s), 0 agent(s), and 1 skill(s).`,
    });
    expect(
      await readFile(
        join(rootPath, ".packs/opencode/packport-control/.opencode/skills/check-pack/SKILL.md"),
        "utf8",
      ),
    ).toContain("name: check-pack");
  });

  test("check validates aggregate generation with control packs", async () => {
    const rootPath = await createValidPackRepositoryWithControlPack();

    const generateResult = await runCli(["generate", rootPath]);
    const checkResult = await checkPackRepository(rootPath);

    expect(generateResult.exitCode).toBe(0);
    expect(checkResult.ok).toBe(true);
    expect(checkResult.diagnostics).toEqual([]);
  });

  test("reports aggregate generation usage errors", async () => {
    const missingTarget = await runCli(["generate", "root", "--target"]);
    const invalidTarget = await runCli(["generate", "root", "--target", "bad-target"]);
    const unknownOption = await runCli(["generate", "root", "--include-control-packs"]);
    const tooManyPaths = await runCli(["generate", "root", "output"]);

    expect(missingTarget).toEqual({
      exitCode: 1,
      stderr: `--target requires claude, opencode, or codex.\n${generateUsage}`,
    });
    expect(invalidTarget).toEqual({
      exitCode: 1,
      stderr: `--target requires claude, opencode, or codex.\n${generateUsage}`,
    });
    expect(unknownOption).toEqual({
      exitCode: 1,
      stderr: `Unknown generate option '--include-control-packs'.\n${generateUsage}`,
    });
    expect(tooManyPaths).toEqual({
      exitCode: 1,
      stderr: `generate accepts at most one root path.\n${generateUsage}`,
    });
  });

  test("removes old harness-first generation commands from the CLI", async () => {
    const rootPath = await createValidPackRepository();

    const claudeResult = await runCli(["claude", "generate", rootPath]);
    const opencodeResult = await runCli([
      "opencode",
      "generate",
      rootPath,
      join(rootPath, ".packs/opencode"),
    ]);
    const codexResult = await runCli(["codex", "generate", rootPath]);

    expect(claudeResult).toEqual({
      exitCode: 1,
      stderr: `Unknown command 'claude'.\n${usage}\n${configportUsage}`,
    });
    expect(opencodeResult).toEqual({
      exitCode: 1,
      stderr: `Unknown command 'opencode'.\n${usage}\n${configportUsage}`,
    });
    expect(codexResult).toEqual({
      exitCode: 1,
      stderr: `Unknown command 'codex'.\n${usage}\n${configportUsage}`,
    });
  });

  test("materializes matching configport instructions during generation", async () => {
    const rootPath = await createValidPackRepository();
    await mkdir(join(rootPath, "packs/essentials/instructions/repo-workflow"), {
      recursive: true,
    });
    await writeFile(
      join(rootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      "Project guidance.\n",
    );
    await runCli([
      "configport",
      "instructions",
      "put",
      join(rootPath, ".configport"),
      "personal",
      "codex",
      "essentials",
      "project",
      "--instruction",
      "repo-workflow",
    ]);

    const result = await runCli(["generate", rootPath, "--target", "codex"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `Generated Codex output at ${join(rootPath, ".packs/codex")} with 1 plugin(s), 1 skill(s), 0 agent(s), and 1 marketplace entry(s).`,
    );
    expect(result.stdout).toContain(
      `Materialized configport instructions to ${rootPath} with 1 file(s), 1 instruction(s), and 1 selection(s).`,
    );
    expect(result.stdout).toContain("WARNING unsupported-codex-asset");
    expect(await readFile(join(rootPath, "AGENTS.md"), "utf8")).toContain("Project guidance.");
  });

  test("check reports configport instruction materialization drift", async () => {
    const rootPath = await createValidPackRepository();
    await mkdir(join(rootPath, "packs/essentials/instructions/repo-workflow"), {
      recursive: true,
    });
    await writeFile(
      join(rootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      "Project guidance.\n",
    );
    await runCli([
      "configport",
      "instructions",
      "put",
      join(rootPath, ".configport"),
      "personal",
      "codex",
      "essentials",
      "project",
      "--instruction",
      "repo-workflow",
    ]);
    await runCli(["generate", rootPath, "--target", "codex"]);
    await writeFile(join(rootPath, "AGENTS.md"), "stale instructions\n");

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "configport-instruction-drift",
      message: "Configport instruction output differs from current configport selections.",
      path: join(rootPath, "AGENTS.md"),
      severity: "error",
    });
  });

  test("skips configport instruction materialization when disabled", async () => {
    const rootPath = await createValidPackRepository();
    await mkdir(join(rootPath, "packs/essentials/instructions/repo-workflow"), {
      recursive: true,
    });
    await writeFile(
      join(rootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      "Project guidance.\n",
    );
    await runCli([
      "configport",
      "instructions",
      "put",
      join(rootPath, ".configport"),
      "personal",
      "codex",
      "essentials",
      "project",
      "--instruction",
      "repo-workflow",
    ]);

    const result = await runCli(["generate", rootPath, "--target", "codex", "--no-configport"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `Generated Codex output at ${join(rootPath, ".packs/codex")} with 1 plugin(s), 1 skill(s), 0 agent(s), and 1 marketplace entry(s).`,
    );
    expect(result.stdout).not.toContain("Materialized configport instructions");
    expect(result.stdout).toContain("WARNING unsupported-codex-asset");
    await expect(lstat(join(rootPath, "AGENTS.md"))).rejects.toThrow();

    const checkResult = await checkPackRepository(rootPath);

    expect(checkResult.ok).toBe(true);
    expect(checkResult.lock?.decisions).toContain("generate:no-configport:codex");

    const claudeResult = await runCli(["generate", rootPath, "--target", "claude"]);
    const checkAfterClaudeResult = await checkPackRepository(rootPath);

    expect(claudeResult.exitCode).toBe(0);
    expect(checkAfterClaudeResult.ok).toBe(true);
    expect(checkAfterClaudeResult.lock?.decisions).toContain("generate:no-configport:codex");
    await expect(lstat(join(rootPath, "AGENTS.md"))).rejects.toThrow();

    const codexResult = await runCli(["generate", rootPath, "--target", "codex"]);
    const checkAfterCodexResult = await checkPackRepository(rootPath);

    expect(codexResult.exitCode).toBe(0);
    expect(codexResult.stdout).toContain("Materialized configport instructions");
    expect(checkAfterCodexResult.ok).toBe(true);
    expect(checkAfterCodexResult.lock?.decisions).not.toContain("generate:no-configport:codex");
  });

  test("returns generation diagnostics for invalid pack source", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-cli-generate-invalid-"));
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

    const result = await runCli(["generate", rootPath, "--target", "codex"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `Generated Codex output at ${join(rootPath, ".packs/codex")} with 0 plugin(s), 0 skill(s), 0 agent(s), and 0 marketplace entry(s).`,
    );
    expect(result.stdout).toContain("ERROR missing-payload");
    await expect(
      lstat(join(rootPath, ".packs/codex/essentials/skills/commit/SKILL.md")),
    ).rejects.toThrow();
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
      stdout: `Applied configport overlay personal/opencode/todoist to ${outputPath} with 3 file(s).`,
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
      stdout: `Checked configport overlay personal/opencode/todoist at ${outputPath} with 3 file(s).`,
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
      `Checked configport overlay personal/opencode/todoist at ${outputPath} with 3 file(s).`,
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
      stderr: `Unknown command 'wat'.\n${usage}\n${configportUsage}`,
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

/** Creates a repository with only the built-in packport control pack source. */
async function createControlPackRepository(): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), "packport-check-control-"));
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

/** Creates a repository with both built-in control pack sources. */
async function createFullControlPackRepository(): Promise<string> {
  const rootPath = await createControlPackRepository();
  await mkdir(join(rootPath, "packs/configport-control/skills/configure-pack"), {
    recursive: true,
  });
  await writeFile(
    join(rootPath, "packs/configport-control/PACK.md"),
    `---
name: configport-control
version: 0.0.0
description: Config control workflows.
---
`,
  );
  await writeFile(
    join(rootPath, "packs/configport-control/skills/configure-pack/SKILL.md"),
    "# Configure\n",
  );

  return rootPath;
}

/** Rewrites pack.lock.yaml so current generated bytes are locked even when they are stale. */
async function refreshLockFromCurrentGeneratedOutputs(
  rootPath: string,
  additionalOutputs: readonly {
    readonly kind: "config" | "marketplace" | "package";
    readonly packageName?: string;
    readonly path: string;
    readonly target: string;
  }[] = [],
): Promise<void> {
  const discovery = await discoverPackRepository(rootPath);
  const lockResult = await readPackLock(rootPath);
  const lock = lockResult.lock;

  if (!lock) {
    throw new Error("Expected pack.lock.yaml to exist.");
  }

  await writePackLock(
    rootPath,
    await createPackLock(
      rootPath,
      discovery.index,
      lock.tool.version,
      [
        ...lock.outputs.map((output) => ({
          kind: output.kind,
          ...(output.packageName ? { packageName: output.packageName } : {}),
          path: join(rootPath, output.path),
          target: output.target,
        })),
        ...additionalOutputs,
      ],
      lock.decisions,
    ),
  );
}
