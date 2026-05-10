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
      "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n\nFind root causes.\n",
    });

    const result = await discoverPackRepository(rootPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.index.packs).toHaveLength(1);

    const [pack] = result.index.packs;
    expect(pack?.id).toBe("essentials");
    expect(pack?.name).toBe("Essentials");
    expect(pack?.assets.map((asset) => asset.id)).toEqual([
      "essentials/command/commit",
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
