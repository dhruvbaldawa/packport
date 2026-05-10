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

  test("reports structural facts without semantic config classification", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Todoist workflows",
        name: "todoist",
        version: "1.0.0",
      }),
      "commands/search.md": [
        "---",
        "allowed-tools: Bash(scripts/todoist.ts)",
        "---",
        "Set $" + "{TODOIST_BRACED_TOKEN} and $TODOIST_PLAIN_TOKEN before use.",
        "Load --env-file=.env before running.",
        "Read ~/.config/todoist/config.toml. Then call the helper.",
      ].join("\n"),
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.plugins[0]?.assets[0]).toMatchObject({
      classification: "pack-candidate",
      decisionRequired: true,
      facts: [
        {
          kind: "config-path-reference",
          message: "References config-like path .env.",
          value: ".env",
        },
        {
          kind: "config-path-reference",
          message: "References config-like path ~/.config/todoist/config.toml.",
          value: "~/.config/todoist/config.toml",
        },
        {
          kind: "script-reference",
          message: "References script path scripts/todoist.ts.",
          value: "scripts/todoist.ts",
        },
        {
          kind: "variable-reference",
          message: "References variable TODOIST_BRACED_TOKEN.",
          value: "TODOIST_BRACED_TOKEN",
        },
        {
          kind: "variable-reference",
          message: "References variable TODOIST_PLAIN_TOKEN.",
          value: "TODOIST_PLAIN_TOKEN",
        },
      ],
      kind: "command",
      name: "search",
      path: "commands/search.md",
      pluginName: "todoist",
    });
  });

  test("does not infer config facts from credentials prose", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Security workflows",
        name: "security",
        version: "1.0.0",
      }),
      "commands/review.md": "Review credentials handling and secret storage before deployment.\n",
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.plugins[0]?.assets[0]).toMatchObject({
      classification: "pack-candidate",
      decisionRequired: false,
      facts: [],
      kind: "command",
      name: "review",
      path: "commands/review.md",
      pluginName: "security",
    });
  });

  test("does not infer variable facts from bare uppercase identifiers", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Planning workflows",
        name: "planning",
        version: "1.0.0",
      }),
      "commands/plan.md":
        "Track ARGS, NEEDS_FIX, READY_FOR_REVIEW, and TODOIST_API_TOKEN labels.\n",
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.plugins[0]?.assets[0]).toMatchObject({
      classification: "pack-candidate",
      decisionRequired: false,
      facts: [],
      kind: "command",
      name: "plan",
      path: "commands/plan.md",
      pluginName: "planning",
    });
  });

  test("does not infer variable facts from non-config explicit variables", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Planning workflows",
        name: "planning",
        version: "1.0.0",
      }),
      "commands/plan.md": "Use $ARGS, $" + "{ARGUMENTS}, $TASK_ID, and $SEARCH_SCRIPT.\n",
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.plugins[0]?.assets[0]).toMatchObject({
      classification: "pack-candidate",
      decisionRequired: false,
      facts: [],
      kind: "command",
      name: "plan",
      path: "commands/plan.md",
      pluginName: "planning",
    });
  });

  test("deduplicates repeated structural facts", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Todoist workflows",
        name: "todoist",
        version: "1.0.0",
      }),
      "commands/search.md": [
        "Use $TODOIST_API_TOKEN and $TODOIST_API_TOKEN.",
        "Read settings.json and settings.json.",
        "Run scripts/todoist.ts and scripts/todoist.ts.",
      ].join("\n"),
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.plugins[0]?.assets[0]?.facts).toEqual([
      {
        kind: "config-path-reference",
        message: "References config-like path settings.json.",
        value: "settings.json",
      },
      {
        kind: "script-reference",
        message: "References script path scripts/todoist.ts.",
        value: "scripts/todoist.ts",
      },
      {
        kind: "variable-reference",
        message: "References variable TODOIST_API_TOKEN.",
        value: "TODOIST_API_TOKEN",
      },
    ]);
  });

  test("does not infer script facts from longer path segments", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Script workflows",
        name: "scripts",
        version: "1.0.0",
      }),
      "commands/review.md": [
        "Inspect noscripts/todoist.ts and not-scripts/todoist.ts.",
        "Ignore scripts/todoist.ts-old, scripts/todoist.ts.bak, and scripts/todoist.ts/more.",
      ].join("\n"),
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.plugins[0]?.assets[0]).toMatchObject({
      classification: "pack-candidate",
      decisionRequired: false,
      facts: [],
      kind: "command",
      name: "review",
      path: "commands/review.md",
      pluginName: "scripts",
    });
  });

  test("does not infer config facts from longer config-like suffixes", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Config workflows",
        name: "config",
        version: "1.0.0",
      }),
      "commands/review.md": [
        "Load .env.local, settings.json.bak, and config.toml.example.",
        "Ignore my.env, nosettings.json, myconfig.toml, and prefix~/.config/tool/config.toml.",
      ].join("\n"),
    });

    const result = await scanClaudeMigrationSource(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.plugins[0]?.assets[0]).toMatchObject({
      classification: "pack-candidate",
      decisionRequired: false,
      facts: [],
      kind: "command",
      name: "review",
      path: "commands/review.md",
      pluginName: "config",
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
      "commands/commit.md": [
        "# Commit",
        "",
        "Use $TODOIST_API_TOKEN, scripts/todoist.ts, and settings.json.",
      ].join("\n"),
    });

    const report = formatClaudeMigrationScan(await scanClaudeMigrationSource(rootPath));

    expect(report).toBe(
      [
        `Claude migration scan: ${rootPath}`,
        "Plugins: 1",
        "Assets: 1",
        `essentials@1.0.0 ${rootPath}`,
        "command essentials/commit pack-candidate commands/commit.md",
        "fact config-path-reference settings.json: References config-like path settings.json.",
        "fact script-reference scripts/todoist.ts: References script path scripts/todoist.ts.",
        "fact variable-reference TODOIST_API_TOKEN: References variable TODOIST_API_TOKEN.",
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

  test("excludes user-approved harness-specific plugins from portable source plans", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/marketplace.json": JSON.stringify({
        plugins: [
          { name: "essentials", source: "./essentials" },
          { name: "todoist", source: "./todoist" },
        ],
      }),
      "essentials/.claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      "essentials/commands/commit.md": "# Commit\n",
      "todoist/.claude-plugin/plugin.json": JSON.stringify({
        description: "Claude-only Todoist integration",
        name: "todoist",
        version: "1.0.0",
      }),
      "todoist/commands/search.md": "# Search\n",
    });

    const result = await planClaudeMigration(rootPath, { excludePlugins: ["todoist"] });

    expect(result.diagnostics).toEqual([]);
    expect(result.scan.summary).toEqual({ assets: 2, plugins: 2 });
    expect(result.summary).toEqual({ assets: 1, files: 2, plugins: 1, questions: 0 });
    expect(result.files.map((file) => file.targetPath)).toEqual([
      "packs/essentials/PACK.md",
      "packs/essentials/commands/commit/COMMAND.md",
    ]);
  });

  test("reports unused plugin exclusions", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        description: "Essential workflows",
        name: "essentials",
        version: "1.0.0",
      }),
      "commands/commit.md": "# Commit\n",
    });

    const result = await planClaudeMigration(rootPath, { excludePlugins: ["todoist"] });

    expect(result.diagnostics).toContainEqual({
      code: "unused-claude-plugin-exclusion",
      message: "No Claude plugin named todoist was found to exclude.",
      path: rootPath,
      severity: "warning",
    });
    expect(result.summary).toEqual({ assets: 1, files: 2, plugins: 1, questions: 0 });
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

  test("reports config-looking skill support files as fact questions", async () => {
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
      "packs/essentials/skills/debugging/settings.json",
    ]);
    expect(result.questions).toContainEqual({
      asset: {
        classification: "pack-candidate",
        facts: [
          {
            kind: "config-path-reference",
            message: "References config-like path settings.json.",
            value: "settings.json",
          },
        ],
        kind: "skill",
        name: "debugging",
        path: "skills/debugging/settings.json",
        pluginName: "essentials",
      },
      message: "Decide whether this support file is pack source or configport-managed state.",
      reasons: ["References config-like path settings.json."],
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
      "commands/search.md": "Use $TODOIST_API_TOKEN, scripts/todoist.ts, and settings.json.\n",
    });

    const report = formatClaudeMigrationPlan(await planClaudeMigration(rootPath));

    expect(report).toBe(
      [
        `Claude migration plan: ${rootPath}`,
        "Plugins: 1",
        "Assets: 1",
        "Files: 2",
        "Questions: 1",
        "create packs/todoist/PACK.md",
        `copy ${join(rootPath, "commands/search.md")} -> packs/todoist/commands/search/COMMAND.md`,
        "question pack-candidate todoist/search: Decide whether these structural references require pack source files or configport-managed values.",
        "fact config-path-reference settings.json: References config-like path settings.json.",
        "fact script-reference scripts/todoist.ts: References script path scripts/todoist.ts.",
        "fact variable-reference TODOIST_API_TOKEN: References variable TODOIST_API_TOKEN.",
      ].join("\n"),
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
