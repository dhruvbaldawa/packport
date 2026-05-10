// ABOUTME: Verifies read-only Claude marketplace and plugin migration scanning.
// ABOUTME: Keeps migration classification explicit before source generation exists.

import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  formatClaudeMigrationPlan,
  formatClaudeMigrationScan,
  planClaudeMigration,
  scanClaudeMigrationSource,
} from "../src/core/claude-migration";

describe("scanClaudeMigrationSource", () => {
  test("scans Claude marketplace plugins and supported assets", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/marketplace.json": JSON.stringify({
        name: "ccconfigs",
        plugins: [
          { description: "Essential workflows", name: "essentials", source: "./essentials" },
          {
            description: "Dhruv's writing style",
            name: "writing",
            source: "./writing",
          },
        ],
      }),
      "essentials/.claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      "essentials/agents/reviewer.md": `---
name: reviewer
---

# Reviewer
`,
      "essentials/commands/commit.md": `---
allowed-tools: Bash(git:*)
---

# Commit
`,
      "essentials/commands/frontend/component.md": "# Component\n",
      "essentials/skills/debugging/SKILL.md": `---
name: debugging
---

# Debugging
`,
      "writing/.claude-plugin/plugin.json": JSON.stringify({
        description: "Dhruv's writing style",
        name: "writing",
        version: "2.0.0",
      }),
      "writing/skills/writing-like-me/SKILL.md": "# Writing Like Me\n",
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({ assets: 5, plugins: 2 });
    expect(result.plugins.map((plugin) => plugin.name)).toEqual(["essentials", "writing"]);
    expect(result.plugins[0]?.assets.map((asset) => `${asset.kind}:${asset.name}`)).toEqual([
      "agent:reviewer",
      "command:commit",
      "command:frontend/component",
      "skill:debugging",
    ]);
    expect(result.plugins[0]?.assets.map((asset) => asset.classification)).toEqual([
      "pack-candidate",
      "pack-candidate",
      "pack-candidate",
      "pack-candidate",
    ]);
    expect(result.plugins[0]?.assets.every((asset) => asset.decisionRequired)).toBe(false);
    expect(result.plugins[1]?.assets[0]?.classification).toBe("pack-candidate");
    expect(result.plugins[1]?.assets[0]?.decisionRequired).toBe(false);
  });

  test("scans a standalone Claude plugin directory", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      "commands/doctor.md": `---
description: doctor
---

Run inside Claude Code.
`,
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({ assets: 1, plugins: 1 });
    expect(result.plugins[0]?.assets[0]).toMatchObject({
      classification: "harness-specific",
      decisionRequired: true,
      kind: "command",
      name: "doctor",
      path: "commands/doctor.md",
      pluginName: "essentials",
    });
  });

  test("classifies config-looking assets as configuration candidates", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Todoist workflows",
        name: "todoist",
        version: "1.0.0",
      }),
      "commands/search.md": "Set TODOIST_API_TOKEN as an environment variable before use.\n",
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.plugins[0]?.assets[0]).toMatchObject({
      classification: "configuration-candidate",
      decisionRequired: true,
      kind: "command",
      name: "search",
      path: "commands/search.md",
      pluginName: "todoist",
    });
  });

  test("keeps personal pack names as pack candidates", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Dhruv's writing style",
        name: "writing-like-me",
        version: "1.0.0",
      }),
      "skills/writing-like-me/SKILL.md": "# Writing Like Me\n",
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.plugins[0]?.assets[0]).toMatchObject({
      classification: "pack-candidate",
      decisionRequired: false,
      kind: "skill",
      name: "writing-like-me",
      path: "skills/writing-like-me/SKILL.md",
      pluginName: "writing-like-me",
    });
  });

  test("treats personal names and paths as pack candidates", async () => {
    const rootPath = await createTempRepository("packport-dhruv-scan-");
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      "commands/writing-like-me.md": "# Writing Like Me\n",
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(rootPath).toContain("dhruv");
    expect(result.plugins[0]?.assets[0]?.classification).toBe("pack-candidate");
  });

  test("reports malformed marketplace source paths", async () => {
    for (const source of ["", "../bad", "/tmp/bad", "C:\\bad", "\\\\server\\bad", "bad\0path"]) {
      const rootPath = await createTempRepository();
      await writeFileTree(rootPath, {
        ".claude-plugin/marketplace.json": JSON.stringify({
          plugins: [{ name: "bad", source }],
        }),
      });

      const result = await scanClaudeMigrationSource(rootPath);

      expect(result.diagnostics).toContainEqual({
        code: "invalid-claude-plugin-source",
        message: "Claude marketplace plugin entries must declare safe relative source paths.",
        path: join(rootPath, ".claude-plugin/marketplace.json"),
        severity: "error",
      });
    }
  });

  test("rejects marketplace source paths with symlink components", async () => {
    const rootPath = await createTempRepository();
    const outsidePath = await createTempRepository("packport-claude-outside-");
    await writeFileTree(rootPath, {
      ".claude-plugin/marketplace.json": JSON.stringify({
        plugins: [{ name: "linked", source: "./linked" }],
      }),
    });
    await writeFileTree(outsidePath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Outside",
        name: "outside",
        version: "1.0.0",
      }),
      "commands/outside.md": "# Outside\n",
    });
    await symlink(outsidePath, join(rootPath, "linked"));

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.plugins).toEqual([]);
    expect(result.diagnostics).toContainEqual({
      code: "invalid-claude-plugin-source",
      message: "Claude marketplace plugin source paths must not contain symlinks.",
      path: join(rootPath, ".claude-plugin/marketplace.json"),
      severity: "error",
    });
  });

  test("reports marketplace plugin files without throwing", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/marketplace.json": JSON.stringify({
        plugins: [{ name: "bad", source: "./not-a-directory" }],
      }),
      "not-a-directory": "not a plugin directory\n",
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.plugins).toEqual([]);
    expect(result.diagnostics).toContainEqual({
      code: "missing-claude-plugin",
      message: "Claude plugin is missing .claude-plugin/plugin.json.",
      path: join(rootPath, "not-a-directory/.claude-plugin/plugin.json"),
      severity: "error",
    });
  });

  test("ignores asset convention paths that are not directories", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      agents: "not a directory\n",
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({ assets: 0, plugins: 1 });
  });

  test("reports malformed plugin JSON without missing-plugin noise", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": "{",
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.plugins).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "invalid-claude-json",
    ]);
  });

  test("reports missing Claude source", async () => {
    const rootPath = await createTempRepository();

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.plugins).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        code: "missing-claude-source",
        message: "Expected .claude-plugin/marketplace.json or .claude-plugin/plugin.json.",
        path: rootPath,
        severity: "error",
      },
    ]);
  });
});

describe("formatClaudeMigrationScan", () => {
  test("formats scan results deterministically", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      "commands/commit.md": "# Commit\n",
    });

    const report = formatClaudeMigrationScan(await scanClaudeMigrationSource(rootPath));

    expect(report).toBe(
      [
        `Claude migration scan: ${rootPath}`,
        "Plugins: 1",
        "Assets: 1",
        `essentials@1.0.0 ${rootPath}`,
        "command essentials/commit pack-candidate commands/commit.md",
      ].join("\n"),
    );
  });
});

describe("planClaudeMigration", () => {
  test("plans portable pack files without writing them", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      "agents/research/depth.md": "# Research Depth\n",
      "commands/commit.md": "# Commit\n",
      "commands/frontend/component.md": "# Component\n",
      "skills/debugging/SKILL.md": "# Debugging\n",
      "skills/debugging/reference/examples.md": "# Examples\n",
    });

    const result = await planClaudeMigration(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({ assets: 4, files: 6, plugins: 1, questions: 0 });
    expect(result.files.map((file) => file.targetPath)).toEqual([
      "packs/essentials/PACK.md",
      "packs/essentials/agents/research-depth/AGENT.md",
      "packs/essentials/commands/commit/COMMAND.md",
      "packs/essentials/commands/frontend-component/COMMAND.md",
      "packs/essentials/skills/debugging/SKILL.md",
      "packs/essentials/skills/debugging/reference/examples.md",
    ]);
    expect(result.files[1]).toMatchObject({
      action: "copy",
      sourcePath: join(rootPath, "agents/research/depth.md"),
    });
    expect(result.questions).toEqual([]);
  });

  test("reports target collisions after flattening nested Claude names", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      "commands/foo/bar.md": "# Nested\n",
      "commands/foo-bar.md": "# Flat\n",
    });

    const result = await planClaudeMigration(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "migration-target-collision",
      message: `Migration plan target collides with ${join(rootPath, "commands/foo/bar.md")}.`,
      path: join(rootPath, "commands/foo-bar.md"),
      severity: "error",
    });
    expect(result.files.map((file) => file.targetPath)).toEqual([
      "packs/essentials/PACK.md",
      "packs/essentials/commands/foo-bar/COMMAND.md",
    ]);
  });

  test("keeps config-looking skill support files out of pack payload plans", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      "skills/debugging/SKILL.md": "# Debugging\n",
      "skills/debugging/reference/examples.md": "# Examples\n",
      "skills/debugging/settings.json": "{}\n",
    });

    const result = await planClaudeMigration(rootPath);

    expect(result.files.map((file) => file.targetPath)).toEqual([
      "packs/essentials/PACK.md",
      "packs/essentials/skills/debugging/SKILL.md",
      "packs/essentials/skills/debugging/reference/examples.md",
    ]);
    expect(result.questions).toContainEqual({
      asset: {
        classification: "configuration-candidate",
        kind: "skill",
        name: "debugging",
        path: "skills/debugging/settings.json",
        pluginName: "essentials",
      },
      message:
        "Decide how this support file should be represented in configport instead of pack source.",
      reasons: ["Support file path looks like configuration state."],
    });
  });

  test("sanitizes skill support filenames before planning target paths", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      "skills/debugging/..\\..\\outside.md": "# Strange Filename\n",
      "skills/debugging/SKILL.md": "# Debugging\n",
    });

    const result = await planClaudeMigration(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.files.map((file) => file.targetPath)).toEqual([
      "packs/essentials/PACK.md",
      "packs/essentials/skills/debugging/unnamed/unnamed/outside.md",
      "packs/essentials/skills/debugging/SKILL.md",
    ]);
  });

  test("skips assets after plugin pack directory collisions", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/marketplace.json": JSON.stringify({
        plugins: [
          { name: "my-pack", source: "./first" },
          { name: "my pack", source: "./second" },
        ],
      }),
      "first/.claude-plugin/plugin.json": JSON.stringify({
        description: "First",
        name: "my-pack",
        version: "1.0.0",
      }),
      "first/commands/first.md": "# First\n",
      "second/.claude-plugin/plugin.json": JSON.stringify({
        description: "Second",
        name: "my pack",
        version: "1.0.0",
      }),
      "second/commands/second.md": "# Second\n",
    });

    const result = await planClaudeMigration(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "migration-target-collision",
      message: `Migration plan target collides with ${join(rootPath, "first")}.`,
      path: join(rootPath, "second"),
      severity: "error",
    });
    expect(result.files.map((file) => file.targetPath)).toEqual([
      "packs/my-pack/PACK.md",
      "packs/my-pack/commands/first/COMMAND.md",
    ]);
  });
});

describe("formatClaudeMigrationPlan", () => {
  test("formats dry-run migration plans deterministically", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      "commands/commit.md": "# Commit\n",
    });

    const report = formatClaudeMigrationPlan(await planClaudeMigration(rootPath));

    expect(report).toBe(
      [
        `Claude migration plan: ${rootPath}`,
        "Plugins: 1",
        "Assets: 1",
        "Files: 2",
        "Questions: 0",
        "create packs/essentials/PACK.md",
        `copy ${join(rootPath, "commands/commit.md")} -> packs/essentials/commands/commit/COMMAND.md`,
      ].join("\n"),
    );
  });

  test("formats remaining dry-run migration questions", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Todoist workflows",
        name: "todoist",
        version: "1.0.0",
      }),
      "commands/search.md": "Set TODOIST_API_TOKEN as an environment variable before use.\n",
    });

    const report = formatClaudeMigrationPlan(await planClaudeMigration(rootPath));

    expect(report).toContain("Questions: 1");
    expect(report).toContain(
      "question configuration-candidate todoist/search: Decide which parts are pack source versus configport-managed values.",
    );
  });
});

/** Creates an empty temporary repository directory for scanner tests. */
async function createTempRepository(prefix = "packport-claude-scan-"): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

/** Writes a map of relative file paths into a temporary repository tree. */
async function writeFileTree(rootPath: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(rootPath, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, contents);
  }
}
