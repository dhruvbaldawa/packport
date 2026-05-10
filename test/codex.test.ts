// ABOUTME: Verifies Codex plugin package and marketplace generation from portable packs.
// ABOUTME: Covers command-to-skill conversion, marketplace preservation, and safe writes.

import { lstat, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CODEX_MARKETPLACE_FILE, generateCodexOutput } from "../src/core/codex";

describe("generateCodexOutput", () => {
  test("generates Codex plugins and marketplace entries", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    const outputPath = join(rootPath, ".packs/codex");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.2.3
Description: Core workflows.
`,
      "packs/essentials/agents/reviewer/AGENT.md": "Review changes.\n",
      "packs/essentials/commands/plan/COMMAND.md": [
        "---",
        "description: Plan implementation",
        "allowed-tools: Bash(git:*)",
        "---",
        "",
        "Task: $ARGS",
      ].join("\n"),
      "packs/essentials/commands/plan/examples.md": "# Examples\n",
      "packs/essentials/skills/debugging/ASSET.md": "Payload: SKILL.md\n",
      "packs/essentials/skills/debugging/SKILL.md": [
        "---",
        "description: Debug project failures",
        "disable-model-invocation: false",
        "---",
        "",
        "# Debugging",
      ].join("\n"),
      "packs/essentials/skills/debugging/reference/examples.md": "# Debugging examples\n",
    });

    const result = await generateCodexOutput(rootPath, outputPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({
      agents: 1,
      commands: 1,
      files: 7,
      marketplaceEntries: 1,
      plugins: 1,
      skills: 2,
    });
    expect(
      JSON.parse(await readFile(join(outputPath, "essentials/.codex-plugin/plugin.json"), "utf8")),
    ).toEqual({
      author: { name: "packport" },
      description: "Core workflows.",
      interface: {
        category: "Productivity",
        developerName: "packport",
        displayName: "Essentials",
        longDescription: "Core workflows.",
        shortDescription: "Core workflows.",
      },
      license: "UNLICENSED",
      name: "essentials",
      skills: "./skills/",
      version: "1.2.3",
    });
    expect(await readFile(join(outputPath, "essentials/skills/plan/SKILL.md"), "utf8")).toBe(
      [
        "---",
        "name: plan",
        'description: "Plan implementation"',
        "---",
        "",
        "Task: $ARGS",
        "",
      ].join("\n"),
    );
    expect(await readFile(join(outputPath, "essentials/skills/plan/examples.md"), "utf8")).toBe(
      "# Examples\n",
    );
    expect(await readFile(join(outputPath, "essentials/skills/debugging/SKILL.md"), "utf8")).toBe(
      [
        "---",
        "name: debugging",
        'description: "Debug project failures"',
        "disable-model-invocation: false",
        "---",
        "",
        "# Debugging",
        "",
      ].join("\n"),
    );
    expect(
      await readFile(join(outputPath, "essentials/skills/debugging/reference/examples.md"), "utf8"),
    ).toBe("# Debugging examples\n");
    expect(await readFile(join(outputPath, "essentials/agents/reviewer.md"), "utf8")).toBe(
      "Review changes.\n",
    );
    expect(JSON.parse(await readFile(join(rootPath, CODEX_MARKETPLACE_FILE), "utf8"))).toEqual({
      interface: { displayName: "packport Local Packs" },
      name: "packport-local",
      plugins: [
        {
          category: "Productivity",
          name: "essentials",
          policy: {
            authentication: "ON_INSTALL",
            installation: "AVAILABLE",
          },
          source: {
            path: "./.packs/codex/essentials",
            source: "local",
          },
        },
      ],
    });
    await expect(lstat(join(outputPath, "essentials/skills/debugging/ASSET.md"))).rejects.toThrow();
  });

  test("preserves existing marketplace metadata and replaces generated entries", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
      [CODEX_MARKETPLACE_FILE]: JSON.stringify({
        interface: { displayName: "Custom Codex Packs" },
        name: "custom",
        plugins: [
          {
            name: "manual",
            policy: {
              authentication: "ON_USE",
              installation: "INSTALLED_BY_DEFAULT",
            },
            source: {
              path: "./plugins/manual",
              source: "local",
            },
          },
          {
            category: "Old",
            name: "essentials",
            policy: {
              authentication: "ON_INSTALL",
              installation: "AVAILABLE",
            },
            source: {
              path: "./old",
              source: "local",
            },
          },
        ],
      }),
    });

    const result = await generateCodexOutput(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(JSON.parse(await readFile(join(rootPath, CODEX_MARKETPLACE_FILE), "utf8"))).toEqual({
      interface: { displayName: "Custom Codex Packs" },
      name: "custom",
      plugins: [
        {
          name: "manual",
          policy: {
            authentication: "ON_USE",
            installation: "INSTALLED_BY_DEFAULT",
          },
          source: {
            path: "./plugins/manual",
            source: "local",
          },
        },
        {
          category: "Productivity",
          name: "essentials",
          policy: {
            authentication: "ON_INSTALL",
            installation: "AVAILABLE",
          },
          source: {
            path: "./.packs/codex/essentials",
            source: "local",
          },
        },
      ],
    });
  });

  test("replaces unsafe existing marketplace entries for regenerated packs", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
      [CODEX_MARKETPLACE_FILE]: JSON.stringify({
        name: "custom",
        plugins: [
          {
            name: "essentials",
            policy: {
              authentication: "ON_INSTALL",
              installation: "AVAILABLE",
            },
            source: {
              path: "../old-essentials",
              source: "local",
            },
          },
        ],
      }),
    });

    const result = await generateCodexOutput(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(JSON.parse(await readFile(join(rootPath, CODEX_MARKETPLACE_FILE), "utf8"))).toEqual({
      interface: { displayName: "packport Local Packs" },
      name: "custom",
      plugins: [
        {
          category: "Productivity",
          name: "essentials",
          policy: {
            authentication: "ON_INSTALL",
            installation: "AVAILABLE",
          },
          source: {
            path: "./.packs/codex/essentials",
            source: "local",
          },
        },
      ],
    });
  });

  test("reports unsupported hooks as warnings while writing supported Codex output", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
      "packs/essentials/hooks/notify/HOOK.md": "# Notify\n",
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });

    const result = await generateCodexOutput(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "unsupported-codex-asset",
      message: "Codex generation does not support hook assets yet.",
      path: join(rootPath, "packs/essentials/hooks/notify"),
      severity: "warning",
    });
    expect(result.summary.plugins).toBe(1);
    expect(
      await readFile(join(rootPath, ".packs/codex/essentials/skills/debugging/SKILL.md"), "utf8"),
    ).toContain("name: debugging");
  });

  test("does not write output when pack discovery has errors", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    await mkdir(join(rootPath, "packs/essentials/skills/debugging"), { recursive: true });

    const result = await generateCodexOutput(rootPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("missing-pack-file");
    await expect(lstat(join(rootPath, ".packs/codex/essentials"))).rejects.toThrow();
    await expect(lstat(join(rootPath, CODEX_MARKETPLACE_FILE))).rejects.toThrow();
  });

  test("rejects invalid Codex plugin and skill names without writing partial output", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    await writeFileTree(rootPath, {
      "packs/Bad_Name/PACK.md": `Name: Bad
Version: 1.0.0
Description: Bad pack.
`,
      "packs/Bad_Name/skills/Bad_Skill/SKILL.md": "# Bad\n",
    });

    const result = await generateCodexOutput(rootPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-codex-plugin-name",
    );
    expect(result.summary.plugins).toBe(0);
    await expect(lstat(join(rootPath, ".packs/codex/Bad_Name"))).rejects.toThrow();
    await expect(lstat(join(rootPath, CODEX_MARKETPLACE_FILE))).rejects.toThrow();
  });

  test("rejects invalid Codex skill names without writing partial output", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
      "packs/essentials/skills/Bad_Skill/SKILL.md": "# Bad\n",
    });

    const result = await generateCodexOutput(rootPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-codex-skill-name",
    );
    expect(result.summary.skills).toBe(0);
    await expect(lstat(join(rootPath, ".packs/codex/essentials"))).rejects.toThrow();
    await expect(lstat(join(rootPath, CODEX_MARKETPLACE_FILE))).rejects.toThrow();
  });

  test("reports command and skill target collisions without writing partial output", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan command\n",
      "packs/essentials/skills/plan/SKILL.md": "# Plan skill\n",
    });

    const result = await generateCodexOutput(rootPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "codex-target-collision",
    );
    expect(result.summary.skills).toBe(0);
    await expect(
      lstat(join(rootPath, ".packs/codex/essentials/skills/plan/SKILL.md")),
    ).rejects.toThrow();
    await expect(lstat(join(rootPath, CODEX_MARKETPLACE_FILE))).rejects.toThrow();
  });

  test("rejects output roots outside .packs without writing packages or marketplace", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    const outputPath = join(rootPath, "plugins/codex");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });

    const result = await generateCodexOutput(rootPath, outputPath);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-codex-output-path",
      message: "Codex output path must be under .packs/.",
      path: outputPath,
      severity: "error",
    });
    await expect(lstat(join(outputPath, "essentials"))).rejects.toThrow();
    await expect(lstat(join(rootPath, CODEX_MARKETPLACE_FILE))).rejects.toThrow();
  });

  test("does not overwrite malformed existing marketplace files", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    await writeFileTree(rootPath, {
      [CODEX_MARKETPLACE_FILE]: "{\n",
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });

    const result = await generateCodexOutput(rootPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-codex-marketplace",
    );
    expect(await readFile(join(rootPath, CODEX_MARKETPLACE_FILE), "utf8")).toBe("{\n");
    await expect(
      lstat(join(rootPath, ".packs/codex/essentials/skills/debugging/SKILL.md")),
    ).rejects.toThrow();
  });

  test("rejects unsafe existing marketplace source paths without writing output", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    await writeFileTree(rootPath, {
      [CODEX_MARKETPLACE_FILE]: JSON.stringify({
        name: "custom",
        plugins: [
          {
            name: "manual",
            policy: {
              authentication: "ON_INSTALL",
              installation: "AVAILABLE",
            },
            source: {
              path: "../outside",
              source: "local",
            },
          },
        ],
      }),
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });

    const result = await generateCodexOutput(rootPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-codex-marketplace-source-path",
    );
    await expect(
      lstat(join(rootPath, ".packs/codex/essentials/skills/debugging/SKILL.md")),
    ).rejects.toThrow();
  });

  test("rejects symlinked existing marketplace source path components", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    const outsidePath = await createTempRepository("packport-codex-marketplace-source-outside-");
    await writeFileTree(rootPath, {
      [CODEX_MARKETPLACE_FILE]: JSON.stringify({
        name: "custom",
        plugins: [
          {
            name: "manual",
            policy: {
              authentication: "ON_INSTALL",
              installation: "AVAILABLE",
            },
            source: {
              path: "./plugins/manual",
              source: "local",
            },
          },
        ],
      }),
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });
    await mkdir(join(rootPath, "plugins"), { recursive: true });
    await symlink(outsidePath, join(rootPath, "plugins/manual"));

    const result = await generateCodexOutput(rootPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unsafe-codex-marketplace-source-path",
    );
    await expect(
      lstat(join(rootPath, ".packs/codex/essentials/skills/debugging/SKILL.md")),
    ).rejects.toThrow();
  });

  test("refuses symlinked Codex marketplace and target paths", async () => {
    const rootPath = await createTempRepository("packport-codex-source-");
    const outsidePath = await createTempRepository("packport-codex-outside-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });
    await mkdir(join(rootPath, ".agents/plugins"), { recursive: true });
    await writeFile(join(outsidePath, "marketplace.json"), "{}\n");
    await symlink(join(outsidePath, "marketplace.json"), join(rootPath, CODEX_MARKETPLACE_FILE));

    const marketplaceResult = await generateCodexOutput(rootPath);

    expect(marketplaceResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unsafe-codex-marketplace-path",
    );
    expect(await readFile(join(outsidePath, "marketplace.json"), "utf8")).toBe("{}\n");

    const targetRootPath = await createTempRepository("packport-codex-target-");
    const targetOutsidePath = await createTempRepository("packport-codex-target-outside-");
    await writeFileTree(targetRootPath, {
      "packs/essentials/PACK.md": `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });
    await mkdir(join(targetRootPath, ".packs/codex/essentials"), { recursive: true });
    await symlink(targetOutsidePath, join(targetRootPath, ".packs/codex/essentials/skills"));

    const targetResult = await generateCodexOutput(targetRootPath);

    expect(targetResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unsafe-codex-target-path",
    );
    await expect(
      lstat(join(targetOutsidePath, "essentials/skills/debugging/SKILL.md")),
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
