// ABOUTME: Verifies OpenCode output generation from portable pack source.
// ABOUTME: Covers command/agent adaptation and skill directory copying.

import { lstat, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { generateOpenCodeOutput } from "../src/core/opencode";

describe("generateOpenCodeOutput", () => {
  test("generates repo-local OpenCode commands, agents, and skills", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = await createTempRepository("packport-opencode-output-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/agents/reviewer/AGENT.md": [
        "---",
        "description: Reviews code",
        "model: claude-haiku-4-5",
        "color: red",
        "---",
        "",
        "Review changes.",
      ].join("\n"),
      "packs/essentials/commands/plan/COMMAND.md": [
        "---",
        "description: Plan implementation",
        "allowed-tools: Bash(git:*)",
        "---",
        "",
        "Task: $ARGS",
      ].join("\n"),
      "packs/essentials/skills/debugging/ASSET.md": `---
payload: SKILL.md
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
      "packs/essentials/skills/debugging/reference/examples.md": "# Examples\n",
    });

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({ agents: 1, commands: 1, files: 5, skills: 1 });
    expect(JSON.parse(await readFile(join(outputPath, "opencode.json"), "utf8"))).toEqual({
      $schema: "https://opencode.ai/config.json",
    });
    expect(await readFile(join(outputPath, ".opencode/commands/plan.md"), "utf8")).toBe(
      ["---", 'description: "Plan implementation"', "---", "", "Task: $ARGUMENTS", ""].join("\n"),
    );
    expect(await readFile(join(outputPath, ".opencode/agents/reviewer.md"), "utf8")).toBe(
      [
        "---",
        'description: "Reviews code"',
        "mode: subagent",
        "model: anthropic/claude-haiku-4-5",
        "color: error",
        "---",
        "",
        "Review changes.",
        "",
      ].join("\n"),
    );
    expect(await readFile(join(outputPath, ".opencode/skills/debugging/SKILL.md"), "utf8")).toBe(
      [
        "---",
        "name: debugging",
        'description: "debugging skill"',
        "---",
        "",
        "# Debugging",
        "",
      ].join("\n"),
    );
    expect(
      await readFile(join(outputPath, ".opencode/skills/debugging/reference/examples.md"), "utf8"),
    ).toBe("# Examples\n");
    await expect(lstat(join(outputPath, ".opencode/skills/debugging/ASSET.md"))).rejects.toThrow();
  });

  test("preserves existing OpenCode config keys", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = await createTempRepository("packport-opencode-output-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });
    await writeFile(join(outputPath, "opencode.json"), `${JSON.stringify({ theme: "system" })}\n`);

    await generateOpenCodeOutput(rootPath, outputPath);

    expect(JSON.parse(await readFile(join(outputPath, "opencode.json"), "utf8"))).toEqual({
      $schema: "https://opencode.ai/config.json",
      theme: "system",
    });
  });

  test("writes OpenCode SKILL.md from a nonstandard packport skill payload", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = await createTempRepository("packport-opencode-output-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/ASSET.md": `---
payload: README.md
---
`,
      "packs/essentials/skills/debugging/README.md": "# Debugging\n",
      "packs/essentials/skills/debugging/reference/examples.md": "# Examples\n",
    });

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics).toEqual([]);
    expect(await readFile(join(outputPath, ".opencode/skills/debugging/SKILL.md"), "utf8")).toBe(
      [
        "---",
        "name: debugging",
        'description: "debugging skill"',
        "---",
        "",
        "# Debugging",
        "",
      ].join("\n"),
    );
    await expect(lstat(join(outputPath, ".opencode/skills/debugging/README.md"))).rejects.toThrow();
    expect(
      await readFile(join(outputPath, ".opencode/skills/debugging/reference/examples.md"), "utf8"),
    ).toBe("# Examples\n");
  });

  test("does not write output when pack discovery has errors", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = await createTempRepository("packport-opencode-output-");
    await mkdir(join(rootPath, "packs/essentials/commands/plan"), { recursive: true });

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("missing-pack-file");
    await expect(lstat(join(outputPath, "opencode.json"))).rejects.toThrow();
  });

  test("does not overwrite malformed existing OpenCode config", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = await createTempRepository("packport-opencode-output-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });
    await writeFile(join(outputPath, "opencode.json"), "{\n");

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-opencode-config",
    );
    expect(await readFile(join(outputPath, "opencode.json"), "utf8")).toBe("{\n");
    await expect(lstat(join(outputPath, ".opencode/commands/plan.md"))).rejects.toThrow();
  });

  test("refuses symlinked existing OpenCode config paths", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = await createTempRepository("packport-opencode-output-");
    const outsidePath = await createTempRepository("packport-opencode-outside-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });
    await writeFile(join(outsidePath, "opencode.json"), "{}\n");
    await symlink(join(outsidePath, "opencode.json"), join(outputPath, "opencode.json"));

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unsafe-opencode-target-path",
    );
    expect(await readFile(join(outsidePath, "opencode.json"), "utf8")).toBe("{}\n");
    await expect(lstat(join(outputPath, ".opencode/commands/plan.md"))).rejects.toThrow();
  });

  test("refuses symlinked generated OpenCode target directories", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = await createTempRepository("packport-opencode-output-");
    const outsidePath = await createTempRepository("packport-opencode-outside-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });
    await symlink(outsidePath, join(outputPath, ".opencode"));

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unsafe-opencode-target-path",
    );
    await expect(lstat(join(outputPath, "opencode.json"))).rejects.toThrow();
    await expect(lstat(join(outsidePath, "commands/plan.md"))).rejects.toThrow();
  });

  test("reports target collisions without writing partial output", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = await createTempRepository("packport-opencode-output-");
    await writeFileTree(rootPath, {
      "packs/a/PACK.md": `---
name: A
version: 1.0.0
description: First pack.
---
`,
      "packs/a/commands/plan/COMMAND.md": "# First\n",
      "packs/b/PACK.md": `---
name: B
version: 1.0.0
description: Second pack.
---
`,
      "packs/b/commands/plan/COMMAND.md": "# Second\n",
    });

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "opencode-target-collision",
    );
    expect(result.summary.commands).toBe(0);
    await expect(lstat(join(outputPath, "opencode.json"))).rejects.toThrow();
    await expect(lstat(join(outputPath, ".opencode/commands/plan.md"))).rejects.toThrow();
  });

  test("reports invalid OpenCode skill names without writing them", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = await createTempRepository("packport-opencode-output-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/Bad_Name/SKILL.md": "# Bad\n",
    });

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-opencode-skill-name",
    );
    expect(result.summary.skills).toBe(0);
    await expect(lstat(join(outputPath, "opencode.json"))).rejects.toThrow();
    await expect(lstat(join(outputPath, ".opencode/skills/Bad_Name/SKILL.md"))).rejects.toThrow();
  });

  test("reports too-long OpenCode skill names without writing them", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = await createTempRepository("packport-opencode-output-");
    const longName = "a".repeat(65);
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      [`packs/essentials/skills/${longName}/SKILL.md`]: "# Bad\n",
    });

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-opencode-skill-name",
    );
    expect(result.summary.skills).toBe(0);
    await expect(
      lstat(join(outputPath, ".opencode/skills", longName, "SKILL.md")),
    ).rejects.toThrow();
  });
});

/** Creates an empty temporary repository directory. */
async function createTempRepository(prefix: string): Promise<string> {
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
