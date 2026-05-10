// ABOUTME: Verifies generation of packport's harness-native control plugin.
// ABOUTME: Keeps built-in control skills packaged separately from user pack plugins.

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { generateClaudeOutput } from "../src/core/claude";
import {
  CLAUDE_CONTROL_MARKETPLACE_FILE,
  CONFIGPORT_CONTROL_PACK_DIRECTORY,
  CONFIGPORT_CONTROL_PLUGIN_NAME,
  CONTROL_PACK_DIRECTORY,
  CONTROL_PLUGIN_NAME,
  CONTROL_PLUGIN_STATE_FILE,
  discoverControlSkills,
  generateClaudeControlMarketplace,
  generateClaudeControlPlugin,
} from "../src/core/control-plugin";
import { discoverPackRepository } from "../src/core/discovery";
import { detectLockDrift, readPackLock, type PackLock } from "../src/core/lockfile";

describe("control plugin generation", () => {
  test("discovers built-in control skills from source", async () => {
    const skills = await discoverControlSkills(projectRootPath());

    expect(skills.map((skill) => skill.name)).toContain("check-pack");
    expect(await readFile(first(skills).sourcePath, "utf8")).toStartWith("---\n");
  });

  test("generates a Claude control plugin with built-in skills", async () => {
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-control-")), "packport");

    const result = await generateClaudeControlPlugin(projectRootPath(), outputPath, "1.2.3");

    expect(result.pluginPath).toBe(outputPath);
    expect(result.skills.map((skill) => skill.name)).toEqual(["check-pack", "migrate-claude"]);
    expect(result.files).toEqual([
      join(outputPath, ".claude-plugin/plugin.json"),
      join(outputPath, "skills/check-pack/SKILL.md"),
      join(outputPath, "skills/migrate-claude/SKILL.md"),
      join(outputPath, CONTROL_PLUGIN_STATE_FILE),
    ]);
    expect(
      JSON.parse(await readFile(join(outputPath, ".claude-plugin/plugin.json"), "utf8")),
    ).toEqual({
      author: { name: "packport" },
      description: "packport control skills for portable agent packs",
      name: CONTROL_PLUGIN_NAME,
      version: "1.2.3",
    });
    expect(await readFile(join(outputPath, "skills/check-pack/SKILL.md"), "utf8")).toBe(
      await readFile(
        join(projectRootPath(), CONTROL_PACK_DIRECTORY, "skills/check-pack/SKILL.md"),
        "utf8",
      ),
    );
    expect(await readFile(join(outputPath, "skills/migrate-claude/SKILL.md"), "utf8")).toBe(
      await readFile(
        join(projectRootPath(), CONTROL_PACK_DIRECTORY, "skills/migrate-claude/SKILL.md"),
        "utf8",
      ),
    );
    expect(JSON.parse(await readFile(join(outputPath, CONTROL_PLUGIN_STATE_FILE), "utf8"))).toEqual(
      {
        files: [
          ".claude-plugin/plugin.json",
          "skills/check-pack/SKILL.md",
          "skills/migrate-claude/SKILL.md",
        ],
        generatedBy: "packport",
        stateVersion: 1,
      },
    );
  });

  test("generates a Claude configport control plugin with built-in skills", async () => {
    const outputPath = join(await mkdtemp(join(tmpdir(), "configport-control-")), "configport");

    const result = await generateClaudeControlPlugin(
      projectRootPath(),
      outputPath,
      "1.2.3",
      "configport",
    );

    expect(result.pluginPath).toBe(outputPath);
    expect(result.skills.map((skill) => skill.name)).toEqual([
      "apply-pack",
      "configure-pack",
      "configure-tools",
    ]);
    expect(
      JSON.parse(await readFile(join(outputPath, ".claude-plugin/plugin.json"), "utf8")),
    ).toEqual({
      author: { name: "packport" },
      description: "configport control skills for local agent-pack configuration",
      name: CONFIGPORT_CONTROL_PLUGIN_NAME,
      version: "1.2.3",
    });
    expect(await readFile(join(outputPath, "skills/configure-pack/SKILL.md"), "utf8")).toBe(
      await readFile(
        join(
          projectRootPath(),
          CONFIGPORT_CONTROL_PACK_DIRECTORY,
          "skills/configure-pack/SKILL.md",
        ),
        "utf8",
      ),
    );
  });

  test("generates Claude control marketplace metadata", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-control-marketplace-"));
    const packageRootPath = join(rootPath, ".packs/claude");
    await mkdir(join(rootPath, "plugins/manual"), { recursive: true });
    await mkdir(join(rootPath, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(rootPath, CLAUDE_CONTROL_MARKETPLACE_FILE),
      JSON.stringify({
        name: "custom-marketplace",
        owner: { name: "Custom" },
        plugins: [
          {
            description: "Manual plugin",
            name: "manual",
            source: "plugins/manual",
          },
          {
            description: "Old packport plugin",
            name: "packport",
            source: "../old-packport",
          },
        ],
      }),
    );

    const result = await generateClaudeControlMarketplace(rootPath, packageRootPath);

    expect(result.marketplacePath).toBe(join(rootPath, CLAUDE_CONTROL_MARKETPLACE_FILE));
    expect(result.files).toEqual([join(rootPath, CLAUDE_CONTROL_MARKETPLACE_FILE)]);
    expect(result.entries).toEqual([
      {
        description: "Manual plugin",
        name: "manual",
        source: "plugins/manual",
      },
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
    ]);
    expect(
      JSON.parse(await readFile(join(rootPath, CLAUDE_CONTROL_MARKETPLACE_FILE), "utf8")),
    ).toEqual({
      name: "custom-marketplace",
      owner: { name: "Custom" },
      plugins: result.entries,
    });
  });

  test("refreshes the Claude marketplace lock when control metadata is generated", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-control-marketplace-"));
    await mkdir(join(rootPath, "packs/essentials/commands/plan"), { recursive: true });
    await writeFile(
      join(rootPath, "packs/essentials/PACK.md"),
      `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
    );
    await writeFile(join(rootPath, "packs/essentials/commands/plan/COMMAND.md"), "# Plan\n");

    const userResult = await generateClaudeOutput(rootPath);
    const firstLockResult = await readPackLock(rootPath);
    const firstLock = requireLock(firstLockResult.lock);
    const firstMarketplaceOutput = requireMarketplaceOutputHash(firstLock);

    const result = await generateClaudeControlMarketplace(rootPath);
    const lockResult = await readPackLock(rootPath);
    const lock = requireLock(lockResult.lock);
    const marketplaceOutput = requireMarketplaceOutputHash(lock);
    const discovery = await discoverPackRepository(rootPath);

    expect(userResult.diagnostics).toEqual([]);
    expect(result.entries.map((entry) => entry.name)).toEqual([
      "essentials",
      "packport",
      "configport",
    ]);
    expect(marketplaceOutput).not.toBe(firstMarketplaceOutput);
    expect(await detectLockDrift(rootPath, lock, discovery.index)).toEqual([]);
  });

  test("refuses unsafe preserved Claude control marketplace source paths", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-control-marketplace-"));
    await mkdir(join(rootPath, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(rootPath, CLAUDE_CONTROL_MARKETPLACE_FILE),
      JSON.stringify({
        plugins: [
          {
            description: "Manual plugin",
            name: "manual",
            source: "../manual",
          },
        ],
      }),
    );

    await expect(generateClaudeControlMarketplace(rootPath)).rejects.toThrow(
      "Claude marketplace source path is invalid",
    );
  });

  test("refuses symlinked preserved Claude control marketplace source paths", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "packport-control-marketplace-"));
    const outsidePath = await mkdtemp(join(tmpdir(), "packport-control-marketplace-outside-"));
    await mkdir(join(rootPath, "plugins"), { recursive: true });
    await mkdir(join(rootPath, ".claude-plugin"), { recursive: true });
    await symlink(outsidePath, join(rootPath, "plugins/manual"));
    await writeFile(
      join(rootPath, CLAUDE_CONTROL_MARKETPLACE_FILE),
      JSON.stringify({
        plugins: [
          {
            description: "Manual plugin",
            name: "manual",
            source: "plugins/manual",
          },
        ],
      }),
    );

    await expect(generateClaudeControlMarketplace(rootPath)).rejects.toThrow(
      "Generated path must not contain symlinks:",
    );
  });

  test("removes previously generated stale Claude skill files", async () => {
    const sourcePath = await createControlSkillSource({
      "check-pack": "# Check\n",
      stale: "# Stale\n",
    });
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-control-")), "packport");

    await generateClaudeControlPlugin(sourcePath, outputPath, "1.2.3");
    await rm(join(sourcePath, CONTROL_PACK_DIRECTORY, "skills/stale"), { recursive: true });

    await generateClaudeControlPlugin(sourcePath, outputPath, "1.2.3");

    await expect(readFile(join(outputPath, "skills/stale/SKILL.md"), "utf8")).rejects.toThrow();
  });

  test("refuses to generate into the source root or source skills tree", async () => {
    const sourcePath = await createControlSkillSource();

    await expect(generateClaudeControlPlugin(sourcePath, sourcePath, "1.2.3")).rejects.toThrow(
      "Control plugin output path must not be the packport source root.",
    );
    await expect(
      generateClaudeControlPlugin(
        sourcePath,
        join(sourcePath, CONTROL_PACK_DIRECTORY, "skills/generated"),
        "1.2.3",
      ),
    ).rejects.toThrow("Control plugin output path must not be inside a source control pack.");
    await expect(
      generateClaudeControlPlugin(
        sourcePath,
        join(sourcePath, CONTROL_PACK_DIRECTORY, "generated"),
        "1.2.3",
      ),
    ).rejects.toThrow("Control plugin output path must not be inside a source control pack.");
    await expect(
      generateClaudeControlPlugin(
        sourcePath,
        join(sourcePath, CONFIGPORT_CONTROL_PACK_DIRECTORY, "generated"),
        "1.2.3",
        "packport",
      ),
    ).rejects.toThrow("Control plugin output path must not be inside a source control pack.");
    await expect(
      generateClaudeControlPlugin(
        sourcePath,
        join(sourcePath, CONTROL_PACK_DIRECTORY, "generated-configport"),
        "1.2.3",
        "configport",
      ),
    ).rejects.toThrow("Control plugin output path must not be inside a source control pack.");
  });

  test("refuses to remove generated files through symlinked output paths", async () => {
    const sourcePath = await createControlSkillSource();
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-control-")), "packport");
    const outsidePath = await mkdtemp(join(tmpdir(), "packport-control-outside-"));
    await mkdir(outputPath, { recursive: true });
    await mkdir(join(outsidePath, "stale"), { recursive: true });
    await writeFile(join(outsidePath, "stale/SKILL.md"), "# Outside\n");
    await symlink(outsidePath, join(outputPath, "skills"));
    await writeFile(
      join(outputPath, CONTROL_PLUGIN_STATE_FILE),
      JSON.stringify({
        files: ["skills/stale/SKILL.md"],
        generatedBy: "packport",
        stateVersion: 1,
      }),
    );

    await expect(generateClaudeControlPlugin(sourcePath, outputPath, "1.2.3")).rejects.toThrow(
      "Generated path must not contain symlinks:",
    );
    expect(await readFile(join(outsidePath, "stale/SKILL.md"), "utf8")).toBe("# Outside\n");
  });

  test("refuses to write generated files through symlinked output paths", async () => {
    const sourcePath = await createControlSkillSource();
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-control-")), "packport");
    const outsidePath = await mkdtemp(join(tmpdir(), "packport-control-outside-"));
    await mkdir(outputPath, { recursive: true });
    await symlink(outsidePath, join(outputPath, ".claude-plugin"));

    await expect(generateClaudeControlPlugin(sourcePath, outputPath, "1.2.3")).rejects.toThrow(
      "Generated path must not contain symlinks:",
    );
    await expect(readFile(join(outsidePath, "plugin.json"), "utf8")).rejects.toThrow();
  });

  test("refuses to overwrite generated file symlinks", async () => {
    const sourcePath = await createControlSkillSource();
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-control-")), "packport");
    const outsidePath = await mkdtemp(join(tmpdir(), "packport-control-outside-"));
    await mkdir(join(outputPath, ".claude-plugin"), { recursive: true });
    await writeFile(join(outsidePath, "plugin.json"), "outside\n");
    await symlink(join(outsidePath, "plugin.json"), join(outputPath, ".claude-plugin/plugin.json"));

    await expect(generateClaudeControlPlugin(sourcePath, outputPath, "1.2.3")).rejects.toThrow(
      "Generated path must not contain symlinks:",
    );
    expect(await readFile(join(outsidePath, "plugin.json"), "utf8")).toBe("outside\n");
  });

  test("refuses to package symlinked source skills", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "packport-control-source-"));
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-control-")), "packport");
    const outsidePath = await mkdtemp(join(tmpdir(), "packport-control-outside-"));
    await mkdir(join(sourcePath, CONTROL_PACK_DIRECTORY, "skills/check-pack"), { recursive: true });
    await writeFile(join(outsidePath, "SKILL.md"), "# Outside\n");
    await symlink(
      join(outsidePath, "SKILL.md"),
      join(sourcePath, CONTROL_PACK_DIRECTORY, "skills/check-pack/SKILL.md"),
    );

    await expect(generateClaudeControlPlugin(sourcePath, outputPath, "1.2.3")).rejects.toThrow(
      "Generated path must not contain symlinks:",
    );
  });
});

/** Returns the repository root for tests that package real built-in skill source. */
function projectRootPath(): string {
  return join(import.meta.dir, "..");
}

/** Returns a parsed lock in tests that should have generated one. */
function requireLock(lock: PackLock | undefined): PackLock {
  if (!lock) {
    throw new Error("Expected pack.lock.yaml to exist.");
  }

  return lock;
}

/** Returns the locked Claude marketplace hash or throws for clearer test failures. */
function requireMarketplaceOutputHash(lock: PackLock): string {
  const output = lock.outputs.find(
    (candidate) =>
      candidate.target === "claude" &&
      candidate.kind === "marketplace" &&
      candidate.path === ".claude-plugin/marketplace.json",
  );

  if (!output) {
    throw new Error("Expected pack.lock.yaml to include the Claude marketplace output.");
  }

  return output.hash;
}

/** Creates a temporary source tree with one control skill. */
async function createControlSkillSource(
  skills: Readonly<Record<string, string>> = { "check-pack": "# Check\n" },
): Promise<string> {
  const sourcePath = await mkdtemp(join(tmpdir(), "packport-control-source-"));
  await mkdir(join(sourcePath, CONTROL_PACK_DIRECTORY), { recursive: true });
  await writeFile(
    join(sourcePath, CONTROL_PACK_DIRECTORY, "PACK.md"),
    "---\nname: packport-control\nversion: 0.0.0\ndescription: Control workflows.\n---\n",
  );

  for (const [name, contents] of Object.entries(skills)) {
    await mkdir(join(sourcePath, CONTROL_PACK_DIRECTORY, "skills", name), { recursive: true });
    await writeFile(join(sourcePath, CONTROL_PACK_DIRECTORY, "skills", name, "SKILL.md"), contents);
  }

  return sourcePath;
}

/** Returns the first item or throws so tests do not rely on non-null assertions. */
function first<T>(items: readonly T[]): T {
  const item = items[0];

  if (item === undefined) {
    throw new Error("Expected test fixture to contain at least one item.");
  }

  return item;
}
