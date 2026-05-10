// ABOUTME: Verifies OpenCode output generation from portable pack source.
// ABOUTME: Covers command/agent adaptation and skill directory copying.

import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createPackLock, readPackLock, writePackLock } from "../src/core/lockfile";
import { discoverPackRepository } from "../src/core/discovery";
import { generateOpenCodeOutput } from "../src/core/opencode";

describe("generateOpenCodeOutput", () => {
  test("generates repo-local OpenCode commands, agents, and skills", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---

# Essentials

## Needs

- {{tool.git.read}} for repository inspection.
- {{tool.fs.read}} for reviewing files.
- {{mcp.todoist}} when Todoist context is selected.
`,
      "packs/essentials/agents/reviewer/AGENT.md": [
        "---",
        "description: Reviews code",
        "model: claude-haiku-4-5",
        "color: red",
        "---",
        "",
        "Review with {{tool.fs.read}}.",
      ].join("\n"),
      "packs/essentials/commands/plan/COMMAND.md": [
        "---",
        "description: Plan implementation",
        "allowed-tools: Bash(git:*)",
        "---",
        "",
        "Use {{tool.git.read}}.",
        "Task: $ARGS",
      ].join("\n"),
      "packs/essentials/skills/debugging/ASSET.md": `---
payloads:
  - SKILL.md
  - reference/examples.md
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n\nUse {{mcp.todoist}}.\n",
      "packs/essentials/skills/debugging/reference/examples.md":
        "# Examples\nUse {{tool.fs.read}}.\n",
    });

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({ agents: 1, commands: 1, files: 5, skills: 1 });
    expect(JSON.parse(await readFile(join(outputPath, "opencode.json"), "utf8"))).toEqual({
      $schema: "https://opencode.ai/config.json",
    });
    expect(await readFile(join(outputPath, ".opencode/commands/plan.md"), "utf8")).toBe(
      [
        "---",
        'description: "Plan implementation"',
        "---",
        "",
        "Use OpenCode bash permissions for git status, diff, and log commands.",
        "Task: $ARGUMENTS",
        "",
      ].join("\n"),
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
        "Review with OpenCode file read, grep, glob, and list permissions.",
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
        "Use the Todoist MCP server configured for OpenCode.",
        "",
      ].join("\n"),
    );
    expect(
      await readFile(join(outputPath, ".opencode/skills/debugging/reference/examples.md"), "utf8"),
    ).toBe("# Examples\nUse OpenCode file read, grep, glob, and list permissions.\n");
    await expect(lstat(join(outputPath, ".opencode/skills/debugging/ASSET.md"))).rejects.toThrow();
  });

  test("skips built-in control packs unless explicitly included", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
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

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary.skills).toBe(1);
    await expect(
      lstat(join(outputPath, ".opencode/skills/configure-pack/SKILL.md")),
    ).rejects.toThrow();
    await expect(lstat(join(outputPath, ".opencode/skills/check-pack/SKILL.md"))).rejects.toThrow();
    expect(
      await readFile(join(outputPath, ".opencode/skills/debugging/SKILL.md"), "utf8"),
    ).toContain("name: debugging");
  });

  test("includes built-in control packs when requested for dogfood output", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
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

    const result = await generateOpenCodeOutput(rootPath, outputPath, {
      includeControlPacks: true,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.summary.skills).toBe(3);
    expect(
      await readFile(join(outputPath, ".opencode/skills/configure-pack/SKILL.md"), "utf8"),
    ).toContain("name: configure-pack");
    expect(
      await readFile(join(outputPath, ".opencode/skills/check-pack/SKILL.md"), "utf8"),
    ).toContain("name: check-pack");
  });

  test("removes stale OpenCode control-pack output when default generation skips it", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
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

    const dogfoodResult = await generateOpenCodeOutput(rootPath, outputPath, {
      includeControlPacks: true,
    });
    const defaultResult = await generateOpenCodeOutput(rootPath, outputPath);
    const lockResult = await readPackLock(rootPath);

    expect(dogfoodResult.diagnostics).toEqual([]);
    expect(defaultResult.diagnostics).toEqual([]);
    await expect(
      lstat(join(outputPath, ".opencode/skills/configure-pack/SKILL.md")),
    ).rejects.toThrow();
    await expect(lstat(join(outputPath, ".opencode/skills/check-pack/SKILL.md"))).rejects.toThrow();
    expect(lockResult.lock?.outputs.some((output) => output.path.includes("check-pack"))).toBe(
      false,
    );
    expect(lockResult.lock?.outputs.some((output) => output.path.includes("configure-pack"))).toBe(
      false,
    );
  });

  test("rejects stale OpenCode output directories before writing current output", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
      "packs/packport-control/PACK.md": `---
name: packport-control
version: 0.0.0
description: Control workflows.
---
`,
      "packs/packport-control/skills/check-pack/SKILL.md": "# Check\n",
    });

    const dogfoodResult = await generateOpenCodeOutput(rootPath, outputPath, {
      includeControlPacks: true,
    });
    const staleOutputPath = join(outputPath, ".opencode/skills/check-pack/SKILL.md");
    await rm(staleOutputPath, { force: true });
    await mkdir(staleOutputPath, { recursive: true });
    await writeFile(
      join(rootPath, "packs/essentials/skills/debugging/SKILL.md"),
      "# Debugging v2\n",
    );

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(dogfoodResult.diagnostics).toEqual([]);
    expect(result.diagnostics).toContainEqual({
      code: "invalid-stale-opencode-output",
      message:
        "Stale OpenCode output path must be a regular file: .packs/opencode/.opencode/skills/check-pack/SKILL.md.",
      path: staleOutputPath,
      severity: "error",
    });
    expect(
      await readFile(join(outputPath, ".opencode/skills/debugging/SKILL.md"), "utf8"),
    ).not.toContain("v2");
  });

  test("rejects symlinked stale OpenCode output components before cleanup", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
    const outsidePath = await createTempRepository("packport-opencode-outside-");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
      "packs/packport-control/PACK.md": `---
name: packport-control
version: 0.0.0
description: Control workflows.
---
`,
      "packs/packport-control/skills/check-pack/SKILL.md": "# Check\n",
    });

    const dogfoodResult = await generateOpenCodeOutput(rootPath, outputPath, {
      includeControlPacks: true,
    });
    await rm(join(outputPath, ".opencode/skills/check-pack"), {
      force: true,
      recursive: true,
    });
    await mkdir(join(outsidePath, "check-pack"), { recursive: true });
    await writeFile(join(outsidePath, "check-pack/SKILL.md"), "outside\n");
    await symlink(join(outsidePath, "check-pack"), join(outputPath, ".opencode/skills/check-pack"));
    await writeFile(
      join(rootPath, "packs/essentials/skills/debugging/SKILL.md"),
      "# Debugging v2\n",
    );

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(dogfoodResult.diagnostics).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unsafe-stale-opencode-output",
    );
    expect(await readFile(join(outsidePath, "check-pack/SKILL.md"), "utf8")).toBe("outside\n");
    expect(
      await readFile(join(outputPath, ".opencode/skills/debugging/SKILL.md"), "utf8"),
    ).not.toContain("v2");
  });

  test("rejects stale OpenCode package locks outside the OpenCode output root", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
    const readmePath = join(rootPath, "README.md");
    await writeFileTree(rootPath, {
      "README.md": "# Keep me\n",
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n",
    });
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0", [
      { kind: "package", packageName: "opencode", path: readmePath, target: "opencode" },
    ]);
    await writePackLock(rootPath, lock);

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-stale-opencode-output",
      message: "Stale OpenCode output path must stay under .packs/opencode: README.md.",
      path: readmePath,
      severity: "error",
    });
    expect(await readFile(readmePath, "utf8")).toBe("# Keep me\n");
    await expect(lstat(join(outputPath, ".opencode/skills/debugging/SKILL.md"))).rejects.toThrow();
  });

  test("normalizes Claude triple-brace command arguments without portable-ref diagnostics", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": `Task: $${"{{{ARGS}}}"}\n`,
    });

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics).toEqual([]);
    expect(await readFile(join(outputPath, ".opencode/commands/plan.md"), "utf8")).toBe(
      ["---", 'description: "plan command"', "---", "", "Task: $ARGUMENTS", ""].join("\n"),
    );
  });

  test("updates pack.lock.yaml with generated OpenCode outputs under the repo root", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });

    const result = await generateOpenCodeOutput(rootPath, outputPath);
    const lockResult = await readPackLock(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(lockResult.diagnostics).toEqual([]);
    expect(lockResult.lock?.outputs.map((output) => output.path)).toEqual([
      ".packs/opencode/.opencode/commands/plan.md",
      ".packs/opencode/opencode.json",
    ]);
    expect(lockResult.lock?.outputs.every((output) => output.target === "opencode")).toBe(true);
  });

  test("preserves accepted lockfile decisions while updating generated OpenCode outputs", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
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
      ["codex-command-as-skill:essentials/command/plan"],
    );
    await writePackLock(rootPath, lock);

    const result = await generateOpenCodeOutput(rootPath, outputPath);
    const lockResult = await readPackLock(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(lockResult.lock?.decisions).toEqual(["codex-command-as-skill:essentials/command/plan"]);
    expect(lockResult.lock?.outputs.map((output) => output.path)).toContain(
      ".packs/opencode/.opencode/commands/plan.md",
    );
  });

  test("preserves other target output records while updating OpenCode outputs", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
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

    const result = await generateOpenCodeOutput(rootPath, outputPath);
    const lockResult = await readPackLock(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(lockResult.lock?.outputs.map((output) => output.path)).toEqual([
      ".packs/codex/essentials/skills/plan/SKILL.md",
      ".packs/opencode/.opencode/commands/plan.md",
      ".packs/opencode/opencode.json",
    ]);
  });

  test("does not write OpenCode output when the existing lockfile is invalid", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
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

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-lockfile-yaml",
    );
    await expect(lstat(join(outputPath, "opencode.json"))).rejects.toThrow();
  });

  test("rejects OpenCode output roots outside repo-local .packs", async () => {
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

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-opencode-output-root",
      message: "OpenCode output must be written to .packs/opencode under the pack repository.",
      path: outputPath,
      severity: "error",
    });
    await expect(lstat(join(outputPath, "opencode.json"))).rejects.toThrow();
  });

  test("preserves existing OpenCode config keys", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });
    await mkdir(outputPath, { recursive: true });
    await writeFile(join(outputPath, "opencode.json"), `${JSON.stringify({ theme: "system" })}\n`);

    await generateOpenCodeOutput(rootPath, outputPath);

    expect(JSON.parse(await readFile(join(outputPath, "opencode.json"), "utf8"))).toEqual({
      $schema: "https://opencode.ai/config.json",
      theme: "system",
    });
  });

  test("writes OpenCode SKILL.md from a nonstandard packport skill payload", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
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
    const outputPath = join(rootPath, ".packs/opencode");
    await mkdir(join(rootPath, "packs/essentials/commands/plan"), { recursive: true });

    const result = await generateOpenCodeOutput(rootPath, outputPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("missing-pack-file");
    await expect(lstat(join(outputPath, "opencode.json"))).rejects.toThrow();
  });

  test("does not overwrite malformed existing OpenCode config", async () => {
    const rootPath = await createTempRepository("packport-opencode-source-");
    const outputPath = join(rootPath, ".packs/opencode");
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/plan/COMMAND.md": "# Plan\n",
    });
    await mkdir(outputPath, { recursive: true });
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
    const outputPath = join(rootPath, ".packs/opencode");
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
    await mkdir(outputPath, { recursive: true });
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
    const outputPath = join(rootPath, ".packs/opencode");
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
    await mkdir(outputPath, { recursive: true });
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
    const outputPath = join(rootPath, ".packs/opencode");
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
    const outputPath = join(rootPath, ".packs/opencode");
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
    const outputPath = join(rootPath, ".packs/opencode");
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
