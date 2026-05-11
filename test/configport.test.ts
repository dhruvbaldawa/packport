// ABOUTME: Verifies configport profile overlays and materialized output application.
// ABOUTME: Keeps local replacements and overlay files outside portable pack source.

import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  applyConfigportOverlay,
  checkConfigportOverlay,
  CONFIGPORT_OVERLAY_PROVENANCE_FILE,
  CONFIGPORT_STATE_FILE,
  materializeConfigportInstructions,
  readConfigportState,
  writeConfigportInstructionSelection,
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
      instructionSelections: [],
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
    expect(applyResult.summary).toEqual({ files: 3, overlays: 1, replacements: 2 });
    expect(await readFile(join(generatedPath, "commands/search/COMMAND.md"), "utf8")).toBe(
      "Dhruv searches Todoist from /Users/dhruv/todoist.\n",
    );
    expect(await readFile(join(outputPath, "commands/search/COMMAND.md"), "utf8")).toBe(
      "Avery searches Todoist from /home/avery/todoist.\n",
    );
    expect(await readFile(join(outputPath, ".opencode/local.conf"), "utf8")).toBe(
      "theme = system\n",
    );
    expect(
      JSON.parse(await readFile(join(outputPath, CONFIGPORT_OVERLAY_PROVENANCE_FILE), "utf8")),
    ).toEqual({
      files: 1,
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      provenanceVersion: 1,
      replacements: 2,
      statePath: join(stateRootPath, CONFIGPORT_STATE_FILE),
      target: "opencode",
    });
  });

  test("checks materialized overlay drift without rewriting output", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(generatedPath, {
      "commands/search/COMMAND.md": "Dhruv searches Todoist.\n",
    });
    await writeConfigportOverlay(stateRootPath, {
      files: [{ content: "theme = system\n", path: ".opencode/local.conf" }],
      pack: "todoist",
      profile: "personal",
      replacements: [{ from: "Dhruv", to: "Avery" }],
      target: "opencode",
    });
    await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    const cleanResult = await checkConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(cleanResult.diagnostics).toEqual([]);
    expect(cleanResult.summary).toEqual({ files: 3, overlays: 1, replacements: 1 });

    await writeFile(join(outputPath, "commands/search/COMMAND.md"), "manual edit\n");
    const driftResult = await checkConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(driftResult.diagnostics).toContainEqual({
      code: "configport-output-drift",
      message: "Materialized configport output differs from the expected overlay result.",
      path: join(outputPath, "commands/search/COMMAND.md"),
      severity: "error",
    });
    expect(await readFile(join(outputPath, "commands/search/COMMAND.md"), "utf8")).toBe(
      "manual edit\n",
    );

    await rm(join(outputPath, ".opencode/local.conf"));
    const missingResult = await checkConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(missingResult.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "configport-output-drift",
      "missing-configport-output",
    ]);
  });

  test("checks overlay provenance drift", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(generatedPath, {
      "commands/search/COMMAND.md": "Search Todoist tasks.\n",
    });
    await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });
    await writeFile(join(outputPath, CONFIGPORT_OVERLAY_PROVENANCE_FILE), "{}\n");

    const result = await checkConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(result.diagnostics).toContainEqual({
      code: "configport-output-drift",
      message: "Materialized configport output differs from the expected overlay result.",
      path: join(outputPath, CONFIGPORT_OVERLAY_PROVENANCE_FILE),
      severity: "error",
    });
    expect(result.summary).toEqual({ files: 2, overlays: 0, replacements: 0 });
  });

  test("rejects generated files at the reserved overlay provenance path", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(generatedPath, {
      [CONFIGPORT_OVERLAY_PROVENANCE_FILE]: "{}\n",
    });

    const result = await applyConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });

    expect(result.diagnostics).toContainEqual({
      code: "reserved-configport-generated-path",
      message: `Generated output path is reserved for configport provenance: ${CONFIGPORT_OVERLAY_PROVENANCE_FILE}.`,
      path: join(generatedPath, CONFIGPORT_OVERLAY_PROVENANCE_FILE),
      severity: "error",
    });
    expect(result.summary).toEqual({ files: 0, overlays: 0, replacements: 0 });
    await expect(lstat(join(outputPath, CONFIGPORT_OVERLAY_PROVENANCE_FILE))).rejects.toThrow();
  });

  test("checks invalid outputs without hiding sibling diagnostics", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const generatedPath = await createTempDirectory("configport-generated-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(generatedPath, {
      "commands/list/COMMAND.md": "List Todoist tasks.\n",
      "commands/search/COMMAND.md": "Search Todoist tasks.\n",
    });
    await mkdir(join(outputPath, "commands/search/COMMAND.md"), { recursive: true });

    const result = await checkConfigportOverlay({
      generatedPath,
      outputPath,
      pack: "todoist",
      profile: "personal",
      stateRootPath,
      target: "opencode",
    });
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain("invalid-configport-output");
    expect(codes).toContain("missing-configport-output");
    expect(codes).not.toContain("unwritable-configport-output-path");
    expect(result.diagnostics).toContainEqual({
      code: "invalid-configport-output",
      message: "Materialized configport output path must be a regular file.",
      path: join(outputPath, "commands/search/COMMAND.md"),
      severity: "error",
    });
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
    expect(result.summary.files).toBe(2);
    expect(await readFile(join(outputPath, ".opencode/local.conf"), "utf8")).toBe(
      "theme = system\n",
    );
  });

  test("rejects overlay files at the reserved overlay provenance path", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");

    const result = await writeConfigportOverlay(stateRootPath, {
      files: [{ content: "{}\n", path: CONFIGPORT_OVERLAY_PROVENANCE_FILE }],
      pack: "todoist",
      profile: "personal",
      replacements: [],
      target: "opencode",
    });

    expect(result.diagnostics).toContainEqual({
      code: "reserved-configport-overlay-path",
      message: `Overlay file path is reserved for configport provenance: ${CONFIGPORT_OVERLAY_PROVENANCE_FILE}.`,
      path: join(stateRootPath, CONFIGPORT_STATE_FILE),
      severity: "error",
    });
    expect(result.summary).toEqual({ files: 0, overlays: 0, replacements: 0 });
    await expect(lstat(join(stateRootPath, CONFIGPORT_STATE_FILE))).rejects.toThrow();
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

describe("configport instruction selections", () => {
  test("stores selected instructions and materializes rendered Codex instructions", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const packRootPath = await createTempDirectory("configport-packs-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(packRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---

## Configuration

- {{config.review_voice}} controls review tone.
`,
      "packs/essentials/instructions/repo-workflow/ASSET.md": `# Packaging Notes

## Needs

- {{tool.git.read}} for repository inspection.
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md":
        "Use {{tool.git.read}} before writing in {{config.review_voice}}.\n",
    });

    const writeResult = await writeConfigportInstructionSelection(stateRootPath, {
      answers: { review_voice: "direct reviewer prose" },
      instructions: ["repo-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "project",
      target: "codex",
    });

    expect(writeResult.diagnostics).toEqual([]);
    expect(writeResult.summary).toEqual({
      answers: 1,
      instructionSelections: 1,
      instructions: 1,
    });

    const materializeResult = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath,
      target: "codex",
    });

    expect(materializeResult.diagnostics).toEqual([]);
    expect(materializeResult.summary).toEqual({ files: 1, instructions: 1 });
    expect(await readFile(join(outputPath, "AGENTS.md"), "utf8")).toBe(
      [
        "<!-- packport-managed-instructions:personal:codex:essentials:project:start -->",
        "<!-- packport-profile: personal -->",
        "<!-- packport-target: codex -->",
        "<!-- packport-scope: project -->",
        "",
        "<!-- packport-source: essentials/instruction/repo-workflow -->",
        "Use Codex shell access for git status, diff, and log commands before writing in direct reviewer prose.",
        "<!-- packport-managed-instructions:personal:codex:essentials:project:end -->",
        "",
      ].join("\n"),
    );
  });

  test("preserves unmanaged instruction file content while replacing managed blocks", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const packRootPath = await createTempDirectory("configport-packs-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(packRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---

## Configuration

- {{config.review_voice}} controls review tone.
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md":
        "Project voice: {{config.review_voice}}.\n",
    });
    await writeFileTree(outputPath, {
      "CLAUDE.md": "# Local Project Notes\n\nKeep this text.\n",
    });

    await writeConfigportInstructionSelection(stateRootPath, {
      answers: { review_voice: "first" },
      instructions: ["repo-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "project",
      target: "claude",
    });
    await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath,
      target: "claude",
    });
    await writeConfigportInstructionSelection(stateRootPath, {
      answers: { review_voice: "second" },
      instructions: ["repo-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "project",
      target: "claude",
    });

    const result = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath,
      target: "claude",
    });
    const content = await readFile(join(outputPath, "CLAUDE.md"), "utf8");

    expect(result.diagnostics).toEqual([]);
    expect(content).toContain("# Local Project Notes\n\nKeep this text.");
    expect(content).toContain("Project voice: second.");
    expect(content).not.toContain("Project voice: first.");
  });

  test("blocks instruction materialization when config answers are missing", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const packRootPath = await createTempDirectory("configport-packs-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(packRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---

## Configuration

- {{config.review_voice}} controls review tone.
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md":
        "Project voice: {{config.review_voice}}.\n",
    });
    await writeConfigportInstructionSelection(stateRootPath, {
      answers: {},
      instructions: ["repo-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "project",
      target: "opencode",
    });

    const result = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath,
      target: "opencode",
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unresolved-config-ref",
    );
    await expect(lstat(join(outputPath, "AGENTS.md"))).rejects.toThrow();
  });

  test("blocks instruction materialization when rendered output still has portable refs", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const packRootPath = await createTempDirectory("configport-packs-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(packRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---

## Configuration

- {{config.review_voice}} controls review tone.
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md":
        "Project voice: {{config.review_voice}}.\n",
    });
    await writeConfigportInstructionSelection(stateRootPath, {
      answers: { review_voice: "{{tool.git.read}}" },
      instructions: ["repo-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "project",
      target: "codex",
    });

    const result = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath,
      target: "codex",
    });

    expect(result.diagnostics).toContainEqual({
      code: "unresolved-configport-instruction-ref",
      message: "Rendered instruction still contains portable ref '{{tool.git.read}}'.",
      path: join(packRootPath, "packs/essentials/instructions/repo-workflow/INSTRUCTION.md"),
      severity: "error",
    });
    await expect(lstat(join(outputPath, "AGENTS.md"))).rejects.toThrow();
  });

  test("preserves overlays and instruction selections across independent writes", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");

    await writeConfigportOverlay(stateRootPath, {
      files: [],
      pack: "essentials",
      profile: "personal",
      replacements: [{ from: "Dhruv", to: "Avery" }],
      target: "codex",
    });
    await writeConfigportInstructionSelection(stateRootPath, {
      answers: { review_voice: "direct" },
      instructions: ["repo-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "project",
      target: "codex",
    });

    let state = (await readConfigportState(stateRootPath)).state;
    expect(state.overlays).toHaveLength(1);
    expect(state.instructionSelections).toHaveLength(1);

    await writeConfigportInstructionSelection(stateRootPath, {
      answers: { review_voice: "other" },
      instructions: ["repo-workflow"],
      pack: "essentials",
      profile: "work",
      scope: "project",
      target: "codex",
    });
    await writeConfigportOverlay(stateRootPath, {
      files: [],
      pack: "essentials",
      profile: "work",
      replacements: [{ from: "Dhruv", to: "Morgan" }],
      target: "codex",
    });

    state = (await readConfigportState(stateRootPath)).state;
    expect(state.overlays.map((overlay) => overlay.profile)).toEqual(["personal", "work"]);
    expect(
      state.instructionSelections.map((selection) => `${selection.profile}:${selection.scope}`),
    ).toEqual(["personal:project", "work:project"]);
  });

  test("keeps project and user instruction scopes as separate managed blocks", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const packRootPath = await createTempDirectory("configport-packs-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(packRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/instructions/project-workflow/INSTRUCTION.md": "Project guidance.\n",
      "packs/essentials/instructions/user-workflow/INSTRUCTION.md": "User guidance.\n",
    });
    await writeConfigportInstructionSelection(stateRootPath, {
      answers: {},
      instructions: ["project-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "project",
      target: "opencode",
    });
    await writeConfigportInstructionSelection(stateRootPath, {
      answers: {},
      instructions: ["user-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "user",
      target: "opencode",
    });

    const projectResult = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath,
      target: "opencode",
    });
    const userResult = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "user",
      stateRootPath,
      target: "opencode",
    });
    const refreshedUserResult = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "user",
      stateRootPath,
      target: "opencode",
    });
    const refreshedProjectResult = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath,
      target: "opencode",
    });
    const content = await readFile(join(outputPath, "AGENTS.md"), "utf8");

    expect(projectResult.diagnostics).toEqual([]);
    expect(userResult.diagnostics).toEqual([]);
    expect(refreshedUserResult.diagnostics).toEqual([]);
    expect(refreshedProjectResult.diagnostics).toEqual([]);
    expect(content).toContain(
      "<!-- packport-managed-instructions:personal:opencode:essentials:project:start -->",
    );
    expect(content).toContain(
      "<!-- packport-managed-instructions:personal:opencode:essentials:user:start -->",
    );
    expect(content).toContain("Project guidance.");
    expect(content).toContain("User guidance.");
    expect(content).toContain(
      [
        "<!-- packport-managed-instructions:personal:opencode:essentials:project:end -->",
        "",
        "<!-- packport-managed-instructions:personal:opencode:essentials:user:start -->",
      ].join("\n"),
    );
    expect(content.endsWith("\n\n")).toBe(false);
  });

  test("blocks instruction materialization when a selected instruction is missing", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const packRootPath = await createTempDirectory("configport-packs-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(packRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
    });
    await writeConfigportInstructionSelection(stateRootPath, {
      answers: {},
      instructions: ["missing-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "project",
      target: "codex",
    });

    const result = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath,
      target: "codex",
    });

    expect(result.diagnostics).toContainEqual({
      code: "missing-configport-instruction",
      message: "Selected instruction asset was not found: missing-workflow.",
      path: "essentials",
      severity: "error",
    });
    await expect(lstat(join(outputPath, "AGENTS.md"))).rejects.toThrow();
  });

  test("reports missing instruction selections and packs without writing output", async () => {
    const missingSelectionStateRootPath = await createTempDirectory("configport-state-");
    const missingSelectionPackRootPath = await createTempDirectory("configport-packs-");
    const missingSelectionOutputPath = await createTempDirectory("configport-output-");
    const missingPackStateRootPath = await createTempDirectory("configport-state-");
    const missingPackRootPath = await createTempDirectory("configport-packs-");
    const missingPackOutputPath = await createTempDirectory("configport-output-");
    await writeFileTree(missingSelectionPackRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
    });
    await writeFileTree(missingPackRootPath, {
      "packs/other/PACK.md": `---
name: Other
version: 1.0.0
description: Other workflows.
---
`,
    });
    await writeConfigportInstructionSelection(missingPackStateRootPath, {
      answers: {},
      instructions: ["repo-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "project",
      target: "codex",
    });

    const missingSelection = await materializeConfigportInstructions({
      outputPath: missingSelectionOutputPath,
      pack: "essentials",
      packRootPath: missingSelectionPackRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath: missingSelectionStateRootPath,
      target: "codex",
    });
    const missingPack = await materializeConfigportInstructions({
      outputPath: missingPackOutputPath,
      pack: "essentials",
      packRootPath: missingPackRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath: missingPackStateRootPath,
      target: "codex",
    });

    expect(missingSelection.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "missing-configport-instruction-selection",
    );
    expect(missingPack.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "missing-configport-instruction-pack",
    );
    await expect(lstat(join(missingSelectionOutputPath, "AGENTS.md"))).rejects.toThrow();
    await expect(lstat(join(missingPackOutputPath, "AGENTS.md"))).rejects.toThrow();
  });

  test("does not overwrite files with incomplete managed instruction blocks", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const packRootPath = await createTempDirectory("configport-packs-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(packRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md": "Project guidance.\n",
    });
    await writeFileTree(outputPath, {
      "AGENTS.md":
        "Existing\n\n<!-- packport-managed-instructions:personal:codex:essentials:project:start -->\nBroken\n",
    });
    await writeConfigportInstructionSelection(stateRootPath, {
      answers: {},
      instructions: ["repo-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "project",
      target: "codex",
    });

    const result = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath,
      target: "codex",
    });

    expect(result.diagnostics).toContainEqual({
      code: "invalid-configport-managed-block",
      message: "Existing instruction target has an incomplete packport managed block.",
      path: join(outputPath, "AGENTS.md"),
      severity: "error",
    });
    expect(await readFile(join(outputPath, "AGENTS.md"), "utf8")).toBe(
      "Existing\n\n<!-- packport-managed-instructions:personal:codex:essentials:project:start -->\nBroken\n",
    );
  });

  test("revalidates persisted instruction selections before materializing", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const packRootPath = await createTempDirectory("configport-packs-");
    const outputPath = await createTempDirectory("configport-output-");
    await writeFileTree(packRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
    });
    await writeFile(
      join(stateRootPath, CONFIGPORT_STATE_FILE),
      JSON.stringify({
        instructionSelections: [
          {
            answers: {},
            instructions: [],
            pack: "essentials",
            profile: "personal",
            scope: "project",
            target: "codex",
          },
        ],
        overlays: [],
        stateVersion: 1,
      }),
    );

    const result = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath,
      target: "codex",
    });

    expect(result.diagnostics).toContainEqual({
      code: "missing-configport-instructions",
      message: "Instruction selection must include at least one instruction asset.",
      path: join(stateRootPath, CONFIGPORT_STATE_FILE),
      severity: "error",
    });
    await expect(lstat(join(outputPath, "AGENTS.md"))).rejects.toThrow();
  });

  test("preserves unmanaged instruction bytes when appending a managed block", async () => {
    const stateRootPath = await createTempDirectory("configport-state-");
    const packRootPath = await createTempDirectory("configport-packs-");
    const outputPath = await createTempDirectory("configport-output-");
    const unmanagedContent = "# Local Project Notes  \n\nKeep this text.\n\n";
    await writeFileTree(packRootPath, {
      "packs/essentials/PACK.md": `---
name: Essentials
version: 1.0.0
description: Core workflows.
---
`,
      "packs/essentials/instructions/repo-workflow/INSTRUCTION.md": "Project guidance.\n",
    });
    await writeFileTree(outputPath, {
      "AGENTS.md": unmanagedContent,
    });
    await writeConfigportInstructionSelection(stateRootPath, {
      answers: {},
      instructions: ["repo-workflow"],
      pack: "essentials",
      profile: "personal",
      scope: "project",
      target: "codex",
    });

    const result = await materializeConfigportInstructions({
      outputPath,
      pack: "essentials",
      packRootPath,
      profile: "personal",
      scope: "project",
      stateRootPath,
      target: "codex",
    });

    expect(result.diagnostics).toEqual([]);
    expect(await readFile(join(outputPath, "AGENTS.md"), "utf8")).toBe(
      `${unmanagedContent}${[
        "<!-- packport-managed-instructions:personal:codex:essentials:project:start -->",
        "<!-- packport-profile: personal -->",
        "<!-- packport-target: codex -->",
        "<!-- packport-scope: project -->",
        "",
        "<!-- packport-source: essentials/instruction/repo-workflow -->",
        "Project guidance.",
        "<!-- packport-managed-instructions:personal:codex:essentials:project:end -->",
        "",
      ].join("\n")}`,
    );
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
