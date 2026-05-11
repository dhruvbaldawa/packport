// ABOUTME: Verifies convention-based pack discovery against real temporary files.
// ABOUTME: Ensures payload files stay opaque while optional ASSET.md files are parsed.

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { discoverPackRepository } from "../src/core/discovery";

describe("discoverPackRepository", () => {
  test("discovers packs and convention-based assets", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/commit/COMMAND.md": "# Commit\n\nCommit changes.\n",
      "packs/essentials/commands/commit/ASSET.md": `# Packaging Notes

## Needs

- Git read capability.
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md":
        "# Repo Workflow\n\nUse repository context.\n",
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n\nFind root causes.\n",
      "packs/essentials/.mcp.json": '{"mcpServers":{}}\n',
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.index.packs).toHaveLength(1);

    const [pack] = result.index.packs;
    expect(pack?.id).toBe("essentials");
    expect(pack?.name).toBe("Essentials");
    expect(pack?.supportPaths.map((path) => path.endsWith("packs/essentials/.mcp.json"))).toEqual([
      true,
    ]);
    expect(pack?.assets.map((asset) => asset.id)).toEqual([
      "essentials/command/commit",
      "essentials/instruction/repo-workflow",
      "essentials/skill/debugging",
    ]);

    const command = pack?.assets.find((asset) => asset.id === "essentials/command/commit");
    expect(
      command?.payloadPaths.map((payloadPath) =>
        payloadPath.endsWith("commands/commit/COMMAND.md"),
      ),
    ).toEqual([true]);
    expect(command?.contract?.sections).toEqual([
      { body: "- Git read capability.", name: "Needs" },
    ]);

    const skill = pack?.assets.find((asset) => asset.id === "essentials/skill/debugging");
    expect(skill?.contract).toBeUndefined();
  });

  test("discovers declared portable refs in pack, asset, and payload scopes", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---

# Essentials

## Configuration

- {{config.review_voice}} controls review tone.
`,
      "packs/essentials/instructions/repo-workflow/ASSET.md": `# Packaging Notes

## Needs

- {{tool.git.read}} for repository inspection.
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md":
        "Use {{tool.git.read}} before writing notes in {{config.review_voice}}.\n",
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toEqual([]);

    const pack = result.index.packs[0];
    const instruction = pack?.assets[0];

    expect(pack?.declaredRefs.map((ref) => ref.raw)).toEqual(["{{config.review_voice}}"]);
    expect(instruction?.declaredRefs.map((ref) => ref.raw)).toEqual(["{{tool.git.read}}"]);
    expect(instruction?.payloadRefs.map((ref) => ref.raw)).toEqual([
      "{{tool.git.read}}",
      "{{config.review_voice}}",
    ]);
  });

  test("reports missing instruction payload files", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
    });
    await mkdir(join(rootPath, "packs/essentials/instructions/repo-workflow"), {
      recursive: true,
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "missing-payload",
      message: `Asset 'repo-workflow' is missing payload file ${join(
        rootPath,
        "packs/essentials/instructions/repo-workflow/INSTRUCTION.md",
      )}.`,
      path: join(rootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      severity: "error",
    });
  });

  test("reports undeclared portable refs in payload files", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md":
        "Inspect with {{tool.git.read}}.\n",
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "undeclared-portable-ref",
      message: "Portable ref '{{tool.git.read}}' must be declared in PACK.md or ASSET.md.",
      path: join(rootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      severity: "error",
    });
  });

  test("reports unknown portable tool aliases in control-plane declarations", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---

## Needs

- {{tool.shell.rsync}} for remote sync.
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md": "# Repo Workflow\n",
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "unknown-portable-ref-alias",
      message: "Portable tool ref '{{tool.shell.rsync}}' is not in the built-in alias map.",
      path: join(rootPath, "packs/essentials/PACK.md"),
      severity: "error",
    });
  });

  test("reports unknown portable tool aliases in payload files", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---

## Needs

- {{tool.shell.rsync}} for remote sync.
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md":
        "Sync remote context with {{tool.shell.rsync}}.\n",
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "unknown-portable-ref-alias",
      message: "Portable tool ref '{{tool.shell.rsync}}' is not in the built-in alias map.",
      path: join(rootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      severity: "error",
    });
  });

  test("does not treat Claude command argument placeholders as portable refs", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---

# Essentials

## Needs

- {{tool.git.read}} for repository inspection.
`,
      "packs/essentials/commands/plan/COMMAND.md": [
        `Plan this request: $${"{{{ARGS}}}"}`,
        "Fix quality issues in `{{ARGS}}`.",
        "Optimize `{{arg}}`.",
        "Inspect the diff with {{tool.git.read}}.",
      ].join("\n"),
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.index.packs[0]?.assets[0]?.payloadRefs.map((ref) => ref.raw)).toEqual([
      "{{tool.git.read}}",
    ]);
  });

  test("rejects command argument placeholders outside command payloads", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md": "Use {{arg}} here.\n",
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "unknown-portable-ref-namespace",
      message: "Portable ref '{{arg}}' must use one of: config, mcp, tool.",
      path: join(rootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      severity: "error",
    });
  });

  test("rejects unsupported portable ref namespaces and template-like expressions", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md":
        "Write for {{user.name}} and avoid {{tool.git.read | upper}}.\n",
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "unknown-portable-ref-namespace",
      message: "Portable ref '{{user.name}}' must use one of: config, mcp, tool.",
      path: join(rootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      severity: "error",
    });
    expect(result.diagnostics).toContainEqual({
      code: "invalid-portable-ref",
      message:
        "Portable ref '{{tool.git.read | upper}}' must be a simple config.*, mcp.*, or tool.* reference.",
      path: join(rootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      severity: "error",
    });
  });

  test("rejects unclosed portable refs", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md":
        "Write notes in {{config.review_voice.\n",
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-portable-ref",
      message: "Portable ref is missing a closing }} delimiter.",
      path: join(rootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      severity: "error",
    });
  });

  test("reports missing payload files", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
    });
    await mkdir(join(rootPath, "packs/essentials/commands/commit"), { recursive: true });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "missing-payload",
      message: `Asset 'commit' is missing payload file ${join(
        rootPath,
        "packs/essentials/commands/commit/COMMAND.md",
      )}.`,
      path: join(rootPath, "packs/essentials/commands/commit/COMMAND.md"),
      severity: "error",
    });
  });

  test("does not parse payload files as contracts", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/commit/COMMAND.md": `Owner: nobody

# Commit

## Strange Notes

This is payload prose, not packport metadata.
`,
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.index.packs[0]?.assets[0]?.contract).toBeUndefined();
  });

  test("uses ASSET.md payload overrides", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/commit/COMMIT.md": "# Commit\n\nCommit changes.\n",
      "packs/essentials/commands/commit/ASSET.md": `---
payload: COMMIT.md
---
`,
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.index.packs[0]?.assets[0]?.payloadPaths).toEqual([
      join(rootPath, "packs/essentials/commands/commit/COMMIT.md"),
    ]);
  });

  test("uses multiple ASSET.md payload overrides", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/hooks/notify/HOOK.md": "# Notify\n\nSend notifications.\n",
      "packs/essentials/hooks/notify/notify.ts": "export {};\n",
      "packs/essentials/hooks/notify/ASSET.md": `---
payloads:
  - HOOK.md
  - notify.ts
---
`,
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.index.packs[0]?.assets[0]?.payloadPaths).toEqual([
      join(rootPath, "packs/essentials/hooks/notify/HOOK.md"),
      join(rootPath, "packs/essentials/hooks/notify/notify.ts"),
    ]);
  });

  test("parses empty ASSET.md files as present contracts", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/commit/COMMAND.md": "# Commit\n\nCommit changes.\n",
      "packs/essentials/commands/commit/ASSET.md": "",
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.index.packs[0]?.assets[0]?.contract).toEqual({
      keys: {},
      path: join(rootPath, "packs/essentials/commands/commit/ASSET.md"),
      sections: [],
    });
  });

  test("rejects payload directories", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
    });
    await mkdir(join(rootPath, "packs/essentials/commands/commit/COMMAND.md"), {
      recursive: true,
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "missing-payload",
      message: `Asset 'commit' is missing payload file ${join(
        rootPath,
        "packs/essentials/commands/commit/COMMAND.md",
      )}.`,
      path: join(rootPath, "packs/essentials/commands/commit/COMMAND.md"),
      severity: "error",
    });
  });

  test("rejects blank payloads declarations", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/commit/ASSET.md": `---
payloads: []
---
`,
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "missing-payload-declaration",
      message: "payload or payloads must declare at least one relative file path.",
      path: join(rootPath, "packs/essentials/commands/commit/ASSET.md"),
      severity: "error",
    });
  });

  test("rejects blank payload declarations", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/commit/ASSET.md": `---
payload: ""
---
`,
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "missing-payload-declaration",
      message: "payload or payloads must declare at least one relative file path.",
      path: join(rootPath, "packs/essentials/commands/commit/ASSET.md"),
      severity: "error",
    });
  });

  test("rejects payload override paths outside the asset directory", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/commit/ASSET.md": `---
payload: ../COMMAND.md
---
`,
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-payload-path",
      message: "payload path '../COMMAND.md' must be relative to the asset directory.",
      path: join(rootPath, "packs/essentials/commands/commit/ASSET.md"),
      severity: "error",
    });
  });

  test("rejects Windows absolute payload override paths", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/commit/ASSET.md": `---
payload: C:\\Users\\dhruv\\COMMAND.md
---
`,
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-payload-path",
      message:
        "payload path 'C:\\Users\\dhruv\\COMMAND.md' must be relative to the asset directory.",
      path: join(rootPath, "packs/essentials/commands/commit/ASSET.md"),
      severity: "error",
    });
  });

  test("rejects POSIX absolute payload override paths", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/commit/ASSET.md": `---
payload: /tmp/COMMAND.md
---
`,
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-payload-path",
      message: "payload path '/tmp/COMMAND.md' must be relative to the asset directory.",
      path: join(rootPath, "packs/essentials/commands/commit/ASSET.md"),
      severity: "error",
    });
  });

  test("rejects conflicting payload and payloads declarations", async () => {
    const rootPath = await createTempRepository();
    await writeFileTree(rootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/commands/commit/ASSET.md": `---
payload:
payloads:
---
`,
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toContainEqual({
      code: "conflicting-payload-keys",
      message: "ASSET.md must not declare both payload and payloads.",
      path: join(rootPath, "packs/essentials/commands/commit/ASSET.md"),
      severity: "error",
    });
  });
});

/** Creates an empty temporary repository directory for filesystem-backed discovery tests. */
async function createTempRepository(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "packport-"));
}

/** Writes a map of relative file paths into a temporary repository tree. */
async function writeFileTree(rootPath: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(rootPath, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, contents);
  }
}
