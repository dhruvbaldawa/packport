// ABOUTME: Verifies generation of packport's harness-native control plugin.
// ABOUTME: Keeps built-in control skills packaged separately from user pack plugins.

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  CONTROL_PLUGIN_NAME,
  CONTROL_PLUGIN_STATE_FILE,
  discoverControlSkills,
  generateClaudeControlPlugin,
} from "../src/core/control-plugin";

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
      await readFile(join(projectRootPath(), "skills/check-pack/SKILL.md"), "utf8"),
    );
    expect(await readFile(join(outputPath, "skills/migrate-claude/SKILL.md"), "utf8")).toBe(
      await readFile(join(projectRootPath(), "skills/migrate-claude/SKILL.md"), "utf8"),
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

  test("removes previously generated stale Claude skill files", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "packport-control-source-"));
    const outputPath = join(await mkdtemp(join(tmpdir(), "packport-control-")), "packport");
    await mkdir(join(sourcePath, "skills/check-pack"), { recursive: true });
    await mkdir(join(sourcePath, "skills/stale"), { recursive: true });
    await writeFile(join(sourcePath, "skills/check-pack/SKILL.md"), "# Check\n");
    await writeFile(join(sourcePath, "skills/stale/SKILL.md"), "# Stale\n");

    await generateClaudeControlPlugin(sourcePath, outputPath, "1.2.3");
    await rm(join(sourcePath, "skills/stale"), { recursive: true });

    await generateClaudeControlPlugin(sourcePath, outputPath, "1.2.3");

    await expect(readFile(join(outputPath, "skills/stale/SKILL.md"), "utf8")).rejects.toThrow();
  });

  test("refuses to generate into the source root or source skills tree", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "packport-control-source-"));
    await mkdir(join(sourcePath, "skills/check-pack"), { recursive: true });
    await writeFile(join(sourcePath, "skills/check-pack/SKILL.md"), "# Check\n");

    await expect(generateClaudeControlPlugin(sourcePath, sourcePath, "1.2.3")).rejects.toThrow(
      "Control plugin output path must not be the packport source root.",
    );
    await expect(
      generateClaudeControlPlugin(sourcePath, join(sourcePath, "skills/generated"), "1.2.3"),
    ).rejects.toThrow("Control plugin output path must not be inside the source skills directory.");
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
    await mkdir(join(sourcePath, "skills/check-pack"), { recursive: true });
    await writeFile(join(outsidePath, "SKILL.md"), "# Outside\n");
    await symlink(join(outsidePath, "SKILL.md"), join(sourcePath, "skills/check-pack/SKILL.md"));

    await expect(generateClaudeControlPlugin(sourcePath, outputPath, "1.2.3")).rejects.toThrow(
      "Generated path must not contain symlinks:",
    );
  });
});

/** Returns the repository root for tests that package real built-in skill source. */
function projectRootPath(): string {
  return join(import.meta.dir, "..");
}

/** Creates a temporary source tree with one control skill. */
async function createControlSkillSource(): Promise<string> {
  const sourcePath = await mkdtemp(join(tmpdir(), "packport-control-source-"));
  await mkdir(join(sourcePath, "skills/check-pack"), { recursive: true });
  await writeFile(join(sourcePath, "skills/check-pack/SKILL.md"), "# Check\n");

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
