// ABOUTME: Verifies configport profile overlays and materialized output application.
// ABOUTME: Keeps local replacements and overlay files outside portable pack source.

import { lstat, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  applyConfigportOverlay,
  CONFIGPORT_STATE_FILE,
  readConfigportState,
  writeConfigportOverlay,
} from "../src/core/configport";

describe("configport overlays", () => {
  test("stores local replacements and applies them without editing generated source", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(generatedPath, {
      "commands/search/COMMAND.md": "Dhruv searches Todoist from /Users/dhruv/todoist.\n",
    });

    const writeResult = await writeConfigportOverlay(stateRootPath, {
      files: [{ content: "theme = system\n", path: ".opencode/local.conf" }],
      pack: "todoist",
      profile: "personal",
      replacements: [
        { from: "Dhruv", to: "Avery" },
        { from: "/Users/dhruv", to: "/home/avery" },
      ],
      target: "opencode",
    });

    expect(writeResult.diagnostics).toEqual([]);
    expect(writeResult.summary).toEqual({ files: 1, overlays: 1, replacements: 2 });
    expect(JSON.parse(await readFile(join(stateRootPath, CONFIGPORT_STATE_FILE), "utf8"))).toEqual({
      overlays: [
        {
          files: [{ content: "theme = system\n", path: ".opencode/local.conf" }],
          pack: "todoist",
          profile: "personal",
          replacements: [
            { from: "/Users/dhruv", to: "/home/avery" },
            { from: "Dhruv", to: "Avery" },
          ],
          target: "opencode",
        },
      ],
      stateVersion: 1,
    });

    const applyResult = await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(applyResult.diagnostics).toEqual([]);
    expect(applyResult.summary).toEqual({ files: 2, overlays: 1, replacements: 2 });
    expect(await readFile(join(generatedPath, "commands/search/COMMAND.md"), "utf8")).toBe(
      "Dhruv searches Todoist from /Users/dhruv/todoist.\n",
    );
    expect(await readFile(join(outputPath, "commands/search/COMMAND.md"), "utf8")).toBe(
      "Avery searches Todoist from /home/avery/todoist.\n",
    );
    expect(await readFile(join(outputPath, ".opencode/local.conf"), "utf8")).toBe(
      "theme = system\n",
    );
  });

  test("keeps overlays isolated by profile target and pack", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(generatedPath, {
      "commands/search/COMMAND.md": "Dhruv searches Todoist.\n",
    });

    await writeConfigportOverlay(stateRootPath, {
      files: [],
      pack: "todoist",
      profile: "personal",
      replacements: [{ from: "Dhruv", to: "Avery" }],
      target: "opencode",
    });
    await writeConfigportOverlay(stateRootPath, {
      files: [],
      pack: "todoist",
      profile: "work",
      replacements: [{ from: "Dhruv", to: "Morgan" }],
      target: "opencode",
    });

    const applyResult = await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "work",
      stateRootPath,
      target: "opencode",
    });

    expect(applyResult.diagnostics).toEqual([]);
    expect(await readFile(join(outputPath, "commands/search/COMMAND.md"), "utf8")).toBe(
      "Morgan searches Todoist.\n",
    );
    expect((await readConfigportState(stateRootPath)).state.overlays).toHaveLength(2);
  });

  test("lets file overlays replace generated files deterministically", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(generatedPath, {
      ".opencode/local.conf": "theme = default\n",
    });
    await writeConfigportOverlay(stateRootPath, {
      files: [{ content: "theme = system\n", path: ".opencode/local.conf" }],
      pack: "todoist",
      profile: "personal",
      replacements: [],
      target: "opencode",
    });

    const result = await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.summary.files).toBe(1);
    expect(await readFile(join(outputPath, ".opencode/local.conf"), "utf8")).toBe(
      "theme = system\n",
    );
  });

  test("rejects unsafe overlay paths from hand-edited state during apply", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(generatedPath, {
      "commands/search.md": "search\n",
    });
    await writeFile(
      join(stateRootPath, CONFIGPORT_STATE_FILE),
      JSON.stringify({
        overlays: [
          {
            files: [{ content: "bad\n", path: "../outside.md" }],
            pack: "todoist",
            profile: "personal",
            replacements: [],
            target: "opencode",
          },
        ],
        stateVersion: 1,
      }),
    );

    const result = await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-configport-overlay-path",
    );
    await expect(lstat(join(outputPath, "commands/search.md"))).rejects.toThrow();
    await expect(lstat(join(outputPath, "../outside.md"))).rejects.toThrow();
  });

  test("rejects planned file and directory target collisions before writing", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(generatedPath, {
      "commands/search.md": "search\n",
    });
    await writeConfigportOverlay(stateRootPath, {
      files: [{ content: "bad\n", path: "commands" }],
      pack: "todoist",
      profile: "personal",
      replacements: [],
      target: "opencode",
    });

    const result = await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "configport-target-path-collision",
    );
    await expect(lstat(join(outputPath, "commands/search.md"))).rejects.toThrow();
    await expect(lstat(join(outputPath, "commands"))).rejects.toThrow();
  });

  test("rejects output paths inside generated package output", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    await writeFileTree(generatedPath, {
      "commands/search.md": "search\n",
    });

    const samePathResult = await applyConfigportOverlay({
      generatedPath,
      outputPath: generatedPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });
    const nestedOutputPath = join(generatedPath, "materialized");
    const nestedResult = await applyConfigportOverlay({
      generatedPath,
      outputPath: nestedOutputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(samePathResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-configport-output-path",
    );
    expect(nestedResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-configport-output-path",
    );
    await expect(lstat(join(nestedOutputPath, "commands/search.md"))).rejects.toThrow();
    expect(await readFile(join(generatedPath, "commands/search.md"), "utf8")).toBe("search\n");
  });

  test("rejects existing output directory conflicts before writing", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(generatedPath, {
      "commands/search.md": "search\n",
    });
    await mkdir(join(outputPath, "commands/search.md"), { recursive: true });

    const result = await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unwritable-configport-output-path",
    );
    await expect(readFile(join(outputPath, "commands/search.md"), "utf8")).rejects.toThrow();
  });

  test("rejects existing output parent file conflicts before writing", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(generatedPath, {
      "commands/search.md": "search\n",
    });
    await writeFile(join(outputPath, "commands"), "not a directory\n");

    const result = await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unwritable-configport-output-path",
    );
    expect(await readFile(join(outputPath, "commands"), "utf8")).toBe("not a directory\n");
  });

  test("rejects overlay paths outside materialized output", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");

    const result = await writeConfigportOverlay(stateRootPath, {
      files: [{ content: "bad\n", path: "../outside.md" }],
      pack: "todoist",
      profile: "personal",
      replacements: [],
      target: "opencode",
    });

    expect(result.diagnostics).toContainEqual({
      code: "invalid-configport-overlay-path",
      message: "Overlay file path must stay inside the materialized output: ../outside.md.",
      path: join(stateRootPath, CONFIGPORT_STATE_FILE),
      severity: "error",
    });
    await expect(lstat(join(stateRootPath, CONFIGPORT_STATE_FILE))).rejects.toThrow();
  });

  test("rejects directory-like overlay file paths", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");

    const result = await writeConfigportOverlay(stateRootPath, {
      files: [{ content: "bad\n", path: "." }],
      pack: "todoist",
      profile: "personal",
      replacements: [],
      target: "opencode",
    });

    expect(result.diagnostics).toContainEqual({
      code: "invalid-configport-overlay-path",
      message: "Overlay file path must stay inside the materialized output: ..",
      path: join(stateRootPath, CONFIGPORT_STATE_FILE),
      severity: "error",
    });
    await expect(lstat(join(stateRootPath, CONFIGPORT_STATE_FILE))).rejects.toThrow();
  });

  test("refuses symlinked generated input without writing output", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    const outsidePath = await createTempDirectory("configport-outside-");
    await mkdir(join(generatedPath, "commands"), { recursive: true });
    await writeFile(join(outsidePath, "search.md"), "outside\n");
    await symlink(join(outsidePath, "search.md"), join(generatedPath, "commands/search.md"));

    const result = await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unsafe-configport-generated-path",
    );
    await expect(lstat(join(outputPath, "commands/search.md"))).rejects.toThrow();
  });

  test("refuses symlinked generated input ancestor paths", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const realGeneratedParent = await createTempDirectory("configport-generated-real-");
    const linkContainer = await createTempDirectory("configport-generated-link-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(join(realGeneratedParent, "pkg"), {
      "commands/search.md": "search\n",
    });
    await symlink(realGeneratedParent, join(linkContainer, "linked"));

    const result = await applyConfigportOverlay({
      generatedPath: join(linkContainer, "linked/pkg"),
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unsafe-configport-generated-path",
    );
    await expect(lstat(join(outputPath, "commands/search.md"))).rejects.toThrow();
  });

  test("refuses symlinked output paths without writing outside the output tree", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    const outsidePath = await createTempDirectory("configport-outside-");
    await writeFileTree(generatedPath, {
      "commands/search.md": "search\n",
    });
    await symlink(outsidePath, join(outputPath, "commands"));

    const result = await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unsafe-configport-output-path",
    );
    await expect(lstat(join(outsidePath, "search.md"))).rejects.toThrow();
  });
});

async function createTempDirectory(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function writeFileTree(rootPath: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(rootPath, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, contents);
  }
}
