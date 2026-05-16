// ABOUTME: Verifies Claude Code plugin package and marketplace generation from portable packs.
// ABOUTME: Covers native Claude commands, agents, skills, marketplace preservation, and lockfiles.

import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  CLAUDE_DEFAULT_OUTPUT_DIRECTORY,
  CLAUDE_MARKETPLACE_FILE,
  generateClaudeOutput,
} from "../src/core/claude";
import {
  generateClaudeControlMarketplace,
  generateClaudeControlPlugin,
} from "../src/core/control-plugin";
import { discoverPackRepository } from "../src/core/discovery";
import { createPackLock, readPackLock, writePackLock } from "../src/core/lockfile";

describe("generateClaudeOutput", () => {
  test("generates Claude plugins and marketplace entries", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    const outputPath = join(rootPath, CLAUDE_DEFAULT_OUTPUT_DIRECTORY);
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.2.3
description: Core workflows.
---

# Essentials

## Needs

- {{tool.git.read}} for repository inspection.
- {{mcp.todoist}} when Todoist context is selected.
`,
      "packs/essentials/agents/reviewer/AGENT.md": "Review changes.\n",
      "packs/essentials/commands/plan/COMMAND.md": [
        "---",
        "description: Plan implementation",
        "allowed-tools: Bash(git:*)",
        "---",
        "",
        "Use {{tool.git.read}}.",
        "Task: $ARGUMENTS",
      ].join("\n"),
      "packs/essentials/skills/debugging/ASSET.md": `---
payloads:
  - SKILL.md
  - reference/examples.md
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n\nUse {{mcp.todoist}}.\n",
      "packs/essentials/skills/debugging/reference/examples.md":
        "# Debugging examples\nUse {{tool.git.read}}.\n",
      "packs/essentials/.mcp.json": JSON.stringify({
        mcpServers: {
          context7: {
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
          },
        },
      }),
    });

    const result = await generateClaudeOutput(rootPath);
    const lockResult = await readPackLock(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({
      agents: 1,
      commands: 1,
      files: 7,
      marketplaceEntries: 1,
      plugins: 1,
      skills: 1,
    });
    expect(
      JSON.parse(await readFile(join(outputPath, "essentials/.claude-plugin/plugin.json"), "utf8")),
    ).toEqual({
      author: { name: "packport" },
      description: "Core workflows.",
      name: "essentials",
      version: "1.2.3",
    });
    expect(await readFile(join(outputPath, "essentials/commands/plan.md"), "utf8")).toBe(
      [
        "---",
        "description: Plan implementation",
        "allowed-tools: Bash(git:*)",
        "---",
        "",
        "Use Claude Code read tools plus Bash git status, diff, and log commands.",
        "Task: $ARGUMENTS",
        "",
      ].join("\n"),
    );
    expect(await readFile(join(outputPath, "essentials/agents/reviewer.md"), "utf8")).toBe(
      "Review changes.\n",
    );
    expect(await readFile(join(outputPath, "essentials/skills/debugging/SKILL.md"), "utf8")).toBe(
      "# Debugging\n\nUse the Todoist MCP server configured for Claude Code.\n",
    );
    expect(
      await readFile(join(outputPath, "essentials/skills/debugging/reference/examples.md"), "utf8"),
    ).toBe(
      "# Debugging examples\nUse Claude Code read tools plus Bash git status, diff, and log commands.\n",
    );
    expect(JSON.parse(await readFile(join(outputPath, "essentials/.mcp.json"), "utf8"))).toEqual({
      mcpServers: {
        context7: {
          args: ["-y", "@upstash/context7-mcp"],
          command: "npx",
        },
      },
    });
    await expect(lstat(join(outputPath, "essentials/skills/debugging/ASSET.md"))).rejects.toThrow();
    expect(JSON.parse(await readFile(join(rootPath, CLAUDE_MARKETPLACE_FILE), "utf8"))).toEqual({
      name: "packport-local",
      owner: { name: "packport" },
      plugins: [
        {
          description: "Core workflows.",
          name: "essentials",
          source: ".packs/claude/essentials",
        },
      ],
    });
    expect(lockResult.diagnostics).toEqual([]);
    expect(lockResult.lock?.outputs.map((output) => output.path)).toEqual([
      ".claude-plugin/marketplace.json",
      ".packs/claude/essentials/.claude-plugin/plugin.json",
      ".packs/claude/essentials/.mcp.json",
      ".packs/claude/essentials/agents/reviewer.md",
      ".packs/claude/essentials/commands/plan.md",
      ".packs/claude/essentials/skills/debugging/reference/examples.md",
      ".packs/claude/essentials/skills/debugging/SKILL.md",
    ]);
    expect(lockResult.lock?.outputs.every((output) => output.target === "claude")).toBe(true);
    expect(lockResult.lock?.outputs.every((output) => /^[a-f0-9]{64}$/.test(output.hash))).toBe(
      true,
    );
    expect(
      lockResult.lock?.outputs.map((output) => ({
        kind: output.kind,
        ...(output.packageName ? { packageName: output.packageName } : {}),
        path: output.path,
        target: output.target,
      })),
    ).toEqual([
      {
        kind: "marketplace",
        path: ".claude-plugin/marketplace.json",
        target: "claude",
      },
      {
        kind: "package",
        packageName: "essentials",
        path: ".packs/claude/essentials/.claude-plugin/plugin.json",
        target: "claude",
      },
      {
        kind: "package",
        packageName: "essentials",
        path: ".packs/claude/essentials/.mcp.json",
        target: "claude",
      },
      {
        kind: "package",
        packageName: "essentials",
        path: ".packs/claude/essentials/agents/reviewer.md",
        target: "claude",
      },
      {
        kind: "package",
        packageName: "essentials",
        path: ".packs/claude/essentials/commands/plan.md",
        target: "claude",
      },
      {
        kind: "package",
        packageName: "essentials",
        path: ".packs/claude/essentials/skills/debugging/reference/examples.md",
        target: "claude",
      },
      {
        kind: "package",
        packageName: "essentials",
        path: ".packs/claude/essentials/skills/debugging/SKILL.md",
        target: "claude",
      },
    ]);
  });

  test("copies Claude skill support files without ASSET.md declarations", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    const outputPath = join(rootPath, CLAUDE_DEFAULT_OUTPUT_DIRECTORY);
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
      "packs/essentials/skills/debugging/reference/examples.md": "# Examples\n",
    });

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(
      await readFile(join(outputPath, "essentials/skills/debugging/reference/examples.md"), "utf8"),
    ).toBe("# Examples\n");
    await expect(lstat(join(outputPath, "essentials/skills/debugging/ASSET.md"))).rejects.toThrow();
  });

  test("preserves existing marketplace metadata and replaces generated entries", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      [CLAUDE_MARKETPLACE_FILE]: JSON.stringify({
        name: "custom-marketplace",
        owner: { name: "Custom" },
        plugins: [
          {
            description: "Manual plugin",
            name: "manual",
            source: "plugins/manual",
          },
          {
            description: "Old essentials",
            name: "essentials",
            source: "old/essentials",
          },
        ],
      }),
      "plugins/manual/.claude-plugin/plugin.json": "{}\n",
      "old/essentials/.claude-plugin/plugin.json": "{}\n",
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(JSON.parse(await readFile(join(rootPath, CLAUDE_MARKETPLACE_FILE), "utf8"))).toEqual({
      name: "custom-marketplace",
      owner: { name: "Custom" },
      plugins: [
        {
          description: "Manual plugin",
          name: "manual",
          source: "plugins/manual",
        },
        {
          description: "Core workflows.",
          name: "essentials",
          source: ".packs/claude/essentials",
        },
      ],
    });
  });

  test("skips built-in control packs during default user-pack generation", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
      "packs/configport-control/PACK.md": `---
name: configport-control
version: 0.0.0
description: Config control workflows.
---
`,
      "packs/configport-control/skills/configure-pack/SKILL.md": "# Configure\n",
      "packs/packport-control/PACK.md": `---
name: packport-control
version: 0.0.0
description: Control workflows.
---
`,
      "packs/packport-control/skills/check-pack/SKILL.md": "# Check\n",
    });

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary.plugins).toBe(1);
    expect(
      JSON.parse(await readFile(join(rootPath, CLAUDE_MARKETPLACE_FILE), "utf8")).plugins,
    ).toEqual([
      {
        description: "Core workflows.",
        name: "essentials",
        source: ".packs/claude/essentials",
      },
    ]);
    await expect(
      lstat(join(rootPath, ".packs/claude/configport-control/.claude-plugin/plugin.json")),
    ).rejects.toThrow();
    await expect(
      lstat(join(rootPath, ".packs/claude/packport-control/.claude-plugin/plugin.json")),
    ).rejects.toThrow();
  });

  test("preserves repo-local Claude control plugins during user-pack generation", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
      "packs/configport-control/PACK.md": `---
name: configport-control
version: 0.0.0
description: Config control workflows.
---
`,
      "packs/configport-control/skills/configure-pack/SKILL.md": "# Configure\n",
      "packs/packport-control/PACK.md": `---
name: packport-control
version: 0.0.0
description: Control workflows.
---
`,
      "packs/packport-control/skills/check-pack/SKILL.md": "# Check\n",
    });
    await generateClaudeControlPlugin(rootPath, join(rootPath, ".packs/claude/packport"), "0.0.0");
    await generateClaudeControlPlugin(
      rootPath,
      join(rootPath, ".packs/claude/configport"),
      "0.0.0",
      "configport",
    );
    await generateClaudeControlMarketplace(rootPath);

    const result = await generateClaudeOutput(rootPath);
    const lockResult = await readPackLock(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(
      JSON.parse(await readFile(join(rootPath, CLAUDE_MARKETPLACE_FILE), "utf8")).plugins.map(
        (plugin: { name: string }) => plugin.name,
      ),
    ).toEqual(["packport", "configport", "essentials"]);
    expect(
      await readFile(join(rootPath, ".packs/claude/packport/skills/check-pack/SKILL.md"), "utf8"),
    ).toBe("# Check\n");
    expect(
      await readFile(
        join(rootPath, ".packs/claude/configport/skills/configure-pack/SKILL.md"),
        "utf8",
      ),
    ).toBe("# Configure\n");
    expect(
      lockResult.lock?.outputs
        .filter(
          (output) =>
            output.target === "claude" &&
            output.kind === "package" &&
            (output.packageName === "packport" || output.packageName === "configport"),
        )
        .map((output) => output.path),
    ).toEqual([
      ".packs/claude/configport/.claude-plugin/plugin.json",
      ".packs/claude/configport/.packport-control-plugin.json",
      ".packs/claude/configport/skills/configure-pack/SKILL.md",
      ".packs/claude/packport/.claude-plugin/plugin.json",
      ".packs/claude/packport/.packport-control-plugin.json",
      ".packs/claude/packport/skills/check-pack/SKILL.md",
    ]);
    expect(lockResult.lock?.outputs.some((output) => output.packageName === "essentials")).toBe(
      true,
    );
  });

  test("rejects user packs that collide with Claude control plugin names", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      "packs/packport/PACK.md": `---
name: packport
version: 1.0.0
description: User pack with a reserved Claude name.
---
`,
      "packs/packport/skills/debugging/SKILL.md": "# Debugging\n",
      "packs/packport-control/PACK.md": `---
name: packport-control
version: 0.0.0
description: Control workflows.
---
`,
      "packs/packport-control/skills/check-pack/SKILL.md": "# Check\n",
    });
    await generateClaudeControlPlugin(rootPath, join(rootPath, ".packs/claude/packport"), "0.0.0");

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "reserved-claude-plugin-name",
      message: "Claude plugin name is reserved for packport control packages: packport.",
      path: join(rootPath, "packs/packport"),
      severity: "error",
    });
    expect(
      await readFile(join(rootPath, ".packs/claude/packport/skills/check-pack/SKILL.md"), "utf8"),
    ).toBe("# Check\n");
  });

  test("removes stale generated Claude packages when packs disappear", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
      "packs/stale/PACK.md": `---
name: Stale
version: 1.0.0
description: Old workflows.
---
`,
      "packs/stale/commands/old/COMMAND.md": "# Old\n",
    });

    const firstResult = await generateClaudeOutput(rootPath);
    await rm(join(rootPath, "packs/stale"), { force: true, recursive: true });
    const secondResult = await generateClaudeOutput(rootPath);
    const lockResult = await readPackLock(rootPath);

    expect(firstResult.diagnostics).toEqual([]);
    expect(secondResult.diagnostics).toEqual([]);
    expect(
      JSON.parse(await readFile(join(rootPath, CLAUDE_MARKETPLACE_FILE), "utf8")).plugins,
    ).toEqual([
      {
        description: "Core workflows.",
        name: "essentials",
        source: ".packs/claude/essentials",
      },
    ]);
    await expect(lstat(join(rootPath, ".packs/claude/stale/commands/old.md"))).rejects.toThrow();
    expect(lockResult.lock?.outputs.some((output) => output.packageName === "stale")).toBe(false);
  });

  test("rejects stale Claude output directories before writing current output", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
      "packs/stale/PACK.md": `---
name: Stale
version: 1.0.0
description: Old workflows.
---
`,
      "packs/stale/commands/old/COMMAND.md": "# Old\n",
    });

    const firstResult = await generateClaudeOutput(rootPath);
    const staleOutputPath = join(rootPath, ".packs/claude/stale/commands/old.md");
    await rm(join(rootPath, "packs/stale"), { force: true, recursive: true });
    await rm(staleOutputPath, { force: true });
    await mkdir(staleOutputPath, { recursive: true });
    await writeFile(join(rootPath, "packs/essentials/commands/plan/COMMAND.md"), "# Plan v2\n");

    const result = await generateClaudeOutput(rootPath);

    expect(firstResult.diagnostics).toEqual([]);
    expect(result.diagnostics).toContainEqual({
      code: "invalid-stale-claude-output",
      message:
        "Stale Claude output path must be a regular file: .packs/claude/stale/commands/old.md.",
      path: staleOutputPath,
      severity: "error",
    });
    expect(
      await readFile(join(rootPath, ".packs/claude/essentials/commands/plan.md"), "utf8"),
    ).toBe("# Plan\n");
  });

  test("rejects symlinked stale Claude output components before cleanup", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    const outsidePath = await createTempRepository("packport-claude-outside-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
      "packs/stale/PACK.md": `---
name: Stale
version: 1.0.0
description: Old workflows.
---
`,
      "packs/stale/commands/old/COMMAND.md": "# Old\n",
    });

    const firstResult = await generateClaudeOutput(rootPath);
    await rm(join(rootPath, "packs/stale"), { force: true, recursive: true });
    await rm(join(rootPath, ".packs/claude/stale/commands"), { force: true, recursive: true });
    await mkdir(join(outsidePath, "commands"), { recursive: true });
    await writeFile(join(outsidePath, "commands/old.md"), "outside\n");
    await symlink(join(outsidePath, "commands"), join(rootPath, ".packs/claude/stale/commands"));
    await writeFile(join(rootPath, "packs/essentials/commands/plan/COMMAND.md"), "# Plan v2\n");

    const result = await generateClaudeOutput(rootPath);

    expect(firstResult.diagnostics).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unsafe-claude-path");
    expect(await readFile(join(outsidePath, "commands/old.md"), "utf8")).toBe("outside\n");
    expect(
      await readFile(join(rootPath, ".packs/claude/essentials/commands/plan.md"), "utf8"),
    ).toBe("# Plan\n");
  });

  test("rejects stale Claude package locks outside the Claude output root", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    const readmePath = join(rootPath, "README.md");
    await writeFileTree(rootPath, {
      "README.md": "# Keep me\n",
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0", [
      { kind: "package", packageName: "bad", path: readmePath, target: "claude" },
    ]);
    await writePackLock(rootPath, lock);

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-stale-claude-output",
      message: "Stale Claude output path must stay under .packs/claude: README.md.",
      path: readmePath,
      severity: "error",
    });
    expect(await readFile(readmePath, "utf8")).toBe("# Keep me\n");
    await expect(
      lstat(join(rootPath, ".packs/claude/essentials/commands/plan.md")),
    ).rejects.toThrow();
  });

  test("does not overwrite malformed existing marketplace files", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      [CLAUDE_MARKETPLACE_FILE]: "{\n",
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-claude-marketplace",
    );
    expect(await readFile(join(rootPath, CLAUDE_MARKETPLACE_FILE), "utf8")).toBe("{\n");
    await expect(
      lstat(join(rootPath, ".packs/claude/essentials/skills/debugging/SKILL.md")),
    ).rejects.toThrow();
  });

  test("rejects unsafe existing marketplace source paths without writing output", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      [CLAUDE_MARKETPLACE_FILE]: JSON.stringify({
        plugins: [
          {
            description: "Manual plugin",
            name: "manual",
            source: "../manual",
          },
        ],
      }),
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-claude-marketplace-source",
      message: "Claude marketplace local source path must be a safe relative path: ../manual.",
      path: rootPath,
      severity: "error",
    });
    await expect(
      lstat(join(rootPath, ".packs/claude/essentials/skills/debugging/SKILL.md")),
    ).rejects.toThrow();
  });

  test("rejects symlinked existing marketplace source path components", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    const outsidePath = await createTempRepository("packport-claude-outside-");
    await writeFileTree(rootPath, {
      [CLAUDE_MARKETPLACE_FILE]: JSON.stringify({
        plugins: [
          {
            description: "Manual plugin",
            name: "manual",
            source: "plugins/manual",
          },
        ],
      }),
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });
    await mkdir(join(rootPath, "plugins"), { recursive: true });
    await symlink(outsidePath, join(rootPath, "plugins/manual"));

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unsafe-claude-path");
    await expect(
      lstat(join(rootPath, ".packs/claude/essentials/skills/debugging/SKILL.md")),
    ).rejects.toThrow();
  });

  test("preserves other target output records while updating Claude outputs", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    const codexOutputPath = join(rootPath, ".packs/codex/essentials/skills/plan/SKILL.md");
    await writeFileTree(rootPath, {
      ".packs/codex/essentials/skills/plan/SKILL.md": "# Existing Codex output\n",
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0", [
      { kind: "package", packageName: "essentials", path: codexOutputPath, target: "codex" },
    ]);
    await writePackLock(rootPath, lock);

    const result = await generateClaudeOutput(rootPath);
    const lockResult = await readPackLock(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(lockResult.lock?.outputs.map((output) => output.path)).toEqual([
      ".claude-plugin/marketplace.json",
      ".packs/claude/essentials/.claude-plugin/plugin.json",
      ".packs/claude/essentials/commands/plan.md",
      ".packs/codex/essentials/skills/plan/SKILL.md",
    ]);
  });

  test("preserves accepted lockfile decisions while updating Claude outputs", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(
      rootPath,
      discovery.index,
      "0.0.0",
      [],
      ["claude-command-native:essentials/command/plan"],
    );
    await writePackLock(rootPath, lock);

    const result = await generateClaudeOutput(rootPath);
    const lockResult = await readPackLock(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(lockResult.lock?.decisions).toEqual(["claude-command-native:essentials/command/plan"]);
    expect(lockResult.lock?.outputs.map((output) => output.path)).toContain(
      ".packs/claude/essentials/commands/plan.md",
    );
  });

  test("reports unsupported instruction assets as warnings while writing supported output", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md": "# Repo Workflow\n",
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "unsupported-claude-asset",
      message: "Claude generation does not support instruction assets yet.",
      path: join(rootPath, "packs/essentials/instructions/repo-workflow"),
      severity: "warning",
    });
    expect(
      await readFile(join(rootPath, ".packs/claude/essentials/skills/debugging/SKILL.md"), "utf8"),
    ).toBe("# Debugging\n");
  });

  test("does not write output when the existing lockfile is invalid", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      "pack.lock.yaml": "lockfileVersion: [\n",
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-lockfile-yaml",
    );
    await expect(
      lstat(join(rootPath, ".packs/claude/essentials/commands/plan.md")),
    ).rejects.toThrow();
  });

  test("rejects output roots outside repo-local .packs", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    const outputPath = await createTempRepository("packport-claude-output-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });

    const result = await generateClaudeOutput(rootPath, outputPath);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-claude-output-root",
      message: "Claude output must be written to .packs/claude under the pack repository.",
      path: outputPath,
      severity: "error",
    });
    await expect(lstat(join(outputPath, "essentials/commands/plan.md"))).rejects.toThrow();
  });

  test("reports invalid Claude plugin and asset names without writing partial output", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      "packs/Bad_Name/PACK.md": `---
name: Bad
version: 1.0.0
description: Bad workflows.
---
`,
      "packs/Bad_Name/commands/Bad_Command/COMMAND.md": "# Bad\n",
    });

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-claude-plugin-name",
    );
    await expect(
      lstat(join(rootPath, ".packs/claude/Bad_Name/.claude-plugin/plugin.json")),
    ).rejects.toThrow();
  });

  test("reports invalid Claude asset names without writing partial output", async () => {
    const rootPath = await createTempRepository("packport-claude-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/Bad_Command/COMMAND.md": "# Bad\n",
    });

    const result = await generateClaudeOutput(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-claude-asset-name",
      message:
        "Claude asset names must be lowercase alphanumeric with single hyphen separators: Bad_Command.",
      path: join(rootPath, "packs/essentials/commands/Bad_Command"),
      severity: "error",
    });
    await expect(
      lstat(join(rootPath, ".packs/claude/essentials/commands/Bad_Command.md")),
    ).rejects.toThrow();
  });

  test("refuses symlinked Claude marketplace and target paths", async () => {
    const marketplaceRootPath = await createTempRepository("packport-claude-source-");
    const targetRootPath = await createTempRepository("packport-claude-source-");
    const outsideMarketplacePath = await createTempRepository("packport-claude-outside-");
    const outsideTargetPath = await createTempRepository("packport-claude-outside-");
    await writeFileTree(marketplaceRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });
    await writeFileTree(targetRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });
    await mkdir(join(marketplaceRootPath, ".claude-plugin"), { recursive: true });
    await symlink(
      join(outsideMarketplacePath, "marketplace.json"),
      join(marketplaceRootPath, CLAUDE_MARKETPLACE_FILE),
    );
    await mkdir(join(targetRootPath, ".packs"), { recursive: true });
    await symlink(outsideTargetPath, join(targetRootPath, ".packs/claude"));

    const marketplaceResult = await generateClaudeOutput(marketplaceRootPath);
    const targetResult = await generateClaudeOutput(targetRootPath);

    expect(marketplaceResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unsafe-claude-path",
    );
    expect(targetResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unsafe-claude-path",
    );
    await expect(lstat(join(outsideMarketplacePath, "marketplace.json"))).rejects.toThrow();
    await expect(
      lstat(join(outsideTargetPath, "essentials/skills/debugging/SKILL.md")),
    ).rejects.toThrow();
  });
});

async function createTempRepository(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function writeFileTree(rootPath: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(rootPath, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, contents);
  }
}
