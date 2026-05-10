// ABOUTME: Manages configport profile overlays for generated agent-pack output.
// ABOUTME: Keeps local customization state outside reusable pack source.

import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { discoverPackRepository } from "./discovery";
import { renderPortableRefsForTarget, type HarnessTarget } from "./harness-refs";
import { scanPortableRefs } from "./refs";
import type { AssetIndex, Diagnostic } from "./types";

export const CONFIGPORT_STATE_FILE = "configport.json";

export type ConfigportOverlaySelector = {
  readonly pack: string;
  readonly profile: string;
  readonly target: string;
};

export type ConfigportReplacement = {
  readonly from: string;
  readonly to: string;
};

export type ConfigportFileOverlay = {
  readonly content: string;
  readonly path: string;
};

export type ConfigportOverlay = ConfigportOverlaySelector & {
  readonly files: readonly ConfigportFileOverlay[];
  readonly replacements: readonly ConfigportReplacement[];
};

export type ConfigportInstructionScope = "project" | "user";

export type ConfigportInstructionSelection = Omit<ConfigportOverlaySelector, "target"> & {
  readonly answers: Readonly<Record<string, string>>;
  readonly instructions: readonly string[];
  readonly scope: ConfigportInstructionScope;
  readonly target: HarnessTarget;
};

export type ConfigportState = {
  readonly instructionSelections: readonly ConfigportInstructionSelection[];
  readonly overlays: readonly ConfigportOverlay[];
  readonly stateVersion: 1;
};

export type WriteConfigportOverlayResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly state: ConfigportState;
  readonly statePath: string;
  readonly summary: {
    readonly files: number;
    readonly overlays: number;
    readonly replacements: number;
  };
};

export type WriteConfigportInstructionSelectionResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly state: ConfigportState;
  readonly statePath: string;
  readonly summary: {
    readonly answers: number;
    readonly instructionSelections: number;
    readonly instructions: number;
  };
};

export type MaterializeConfigportInstructionsOptions = Omit<ConfigportOverlaySelector, "target"> & {
  readonly outputPath: string;
  readonly packRootPath: string;
  readonly scope: ConfigportInstructionScope;
  readonly stateRootPath: string;
  readonly target: HarnessTarget;
};

export type MaterializeConfigportInstructionsResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly files: readonly string[];
  readonly outputPath: string;
  readonly summary: {
    readonly files: number;
    readonly instructions: number;
  };
};

export type ApplyConfigportOverlayOptions = ConfigportOverlaySelector & {
  readonly generatedPath: string;
  readonly outputPath: string;
  readonly stateRootPath: string;
};

export type ApplyConfigportOverlayResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly files: readonly string[];
  readonly outputPath: string;
  readonly summary: {
    readonly files: number;
    readonly overlays: number;
    readonly replacements: number;
  };
};

export type CheckConfigportOverlayResult = ApplyConfigportOverlayResult;

type ReadConfigportStateResult =
  | { readonly state: ConfigportState; readonly status: "ok" }
  | {
      readonly diagnostics: readonly Diagnostic[];
      readonly state: ConfigportState;
      readonly status: "error";
    };

type PlannedWrite = {
  readonly content: string;
  readonly path: string;
};

type PlannedConfigportOverlay = {
  readonly diagnostics: readonly Diagnostic[];
  readonly overlay?: ConfigportOverlay;
  readonly writes: readonly PlannedWrite[];
};

type PlanConfigportOverlayOptions = {
  readonly checkWritablePaths: boolean;
};

const CONFIG_REF_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/;
const HARNESS_TARGETS = new Set<HarnessTarget>(["claude", "codex", "opencode"]);
const INSTRUCTION_SCOPES = new Set<ConfigportInstructionScope>(["project", "user"]);

/** Reads persisted configport state, returning an empty state when none exists. */
export async function readConfigportState(
  stateRootPath: string,
): Promise<ReadConfigportStateResult> {
  const statePath = configportStatePath(stateRootPath);

  try {
    await assertPathDoesNotContainSymlinks(statePath);
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    const state = normalizeConfigportState(parsed);

    if (state) {
      return { state, status: "ok" };
    }

    return {
      diagnostics: [
        {
          code: "invalid-configport-state",
          message: "configport state must contain stateVersion 1 and an overlays array.",
          path: statePath,
          severity: "error",
        },
      ],
      state: emptyConfigportState(),
      status: "error",
    };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { state: emptyConfigportState(), status: "ok" };
    }

    return {
      diagnostics: [
        {
          code: isSymlinkPathError(error)
            ? "unsafe-configport-state-path"
            : "invalid-configport-state",
          message: error instanceof Error ? error.message : "configport state could not be read.",
          path: statePath,
          severity: "error",
        },
      ],
      state: emptyConfigportState(),
      status: "error",
    };
  }
}

/** Writes or replaces one overlay in local configport state. */
export async function writeConfigportOverlay(
  stateRootPath: string,
  overlay: ConfigportOverlay,
): Promise<WriteConfigportOverlayResult> {
  const statePath = configportStatePath(stateRootPath);
  const diagnostics = validateOverlay(overlay, statePath);
  const existing = await readConfigportState(stateRootPath);

  if (existing.status === "error") {
    diagnostics.push(...existing.diagnostics);
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      diagnostics,
      state: existing.state,
      statePath,
      summary: { files: 0, overlays: existing.state.overlays.length, replacements: 0 },
    };
  }

  const overlays = [
    ...existing.state.overlays.filter((candidate) => !sameOverlaySelector(candidate, overlay)),
    normalizeOverlay(overlay),
  ].sort(compareOverlays);
  const state: ConfigportState = {
    instructionSelections: existing.state.instructionSelections,
    overlays,
    stateVersion: 1,
  };

  await assertPathDoesNotContainSymlinks(statePath);
  await mkdir(dirname(statePath), { recursive: true });
  await assertPathDoesNotContainSymlinks(statePath);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  return {
    diagnostics,
    state,
    statePath,
    summary: {
      files: overlay.files.length,
      overlays: state.overlays.length,
      replacements: overlay.replacements.length,
    },
  };
}

/** Writes or replaces selected instruction assets and local answers in configport state. */
export async function writeConfigportInstructionSelection(
  stateRootPath: string,
  selection: ConfigportInstructionSelection,
): Promise<WriteConfigportInstructionSelectionResult> {
  const statePath = configportStatePath(stateRootPath);
  const diagnostics = validateInstructionSelection(selection, statePath);
  const existing = await readConfigportState(stateRootPath);

  if (existing.status === "error") {
    diagnostics.push(...existing.diagnostics);
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      diagnostics,
      state: existing.state,
      statePath,
      summary: {
        answers: 0,
        instructionSelections: existing.state.instructionSelections.length,
        instructions: 0,
      },
    };
  }

  const instructionSelections = [
    ...existing.state.instructionSelections.filter(
      (candidate) => !sameInstructionSelection(candidate, selection),
    ),
    normalizeInstructionSelection(selection),
  ].sort(compareInstructionSelections);
  const state: ConfigportState = {
    instructionSelections,
    overlays: existing.state.overlays,
    stateVersion: 1,
  };

  await assertPathDoesNotContainSymlinks(statePath);
  await mkdir(dirname(statePath), { recursive: true });
  await assertPathDoesNotContainSymlinks(statePath);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  return {
    diagnostics,
    state,
    statePath,
    summary: {
      answers: Object.keys(selection.answers).length,
      instructionSelections: state.instructionSelections.length,
      instructions: selection.instructions.length,
    },
  };
}

/** Applies generated pack output plus a selected local overlay into a materialized output tree. */
export async function applyConfigportOverlay(
  options: ApplyConfigportOverlayOptions,
): Promise<ApplyConfigportOverlayResult> {
  const plan = await planConfigportOverlay(options, { checkWritablePaths: true });
  const files: string[] = [];

  if (!hasError(plan.diagnostics)) {
    for (const write of plan.writes) {
      await writeMaterializedFile(write.path, write.content);
      files.push(write.path);
    }
  }

  return {
    diagnostics: plan.diagnostics,
    files,
    outputPath: options.outputPath,
    summary: {
      files: files.length,
      overlays: plan.overlay ? 1 : 0,
      replacements: plan.overlay?.replacements.length ?? 0,
    },
  };
}

/** Checks whether materialized output matches generated pack output plus local overlay state. */
export async function checkConfigportOverlay(
  options: ApplyConfigportOverlayOptions,
): Promise<CheckConfigportOverlayResult> {
  const plan = await planConfigportOverlay(options, { checkWritablePaths: false });
  const diagnostics = [...plan.diagnostics];
  const files: string[] = [];

  if (!hasError(diagnostics)) {
    for (const write of plan.writes) {
      const currentContent = await readMaterializedFileForCheck(write.path, diagnostics);

      if (currentContent === undefined) {
        continue;
      }

      files.push(write.path);

      if (currentContent !== write.content) {
        diagnostics.push({
          code: "configport-output-drift",
          message: "Materialized configport output differs from the expected overlay result.",
          path: write.path,
          severity: "error",
        });
      }
    }
  }

  return {
    diagnostics,
    files,
    outputPath: options.outputPath,
    summary: {
      files: plan.writes.length,
      overlays: plan.overlay ? 1 : 0,
      replacements: plan.overlay?.replacements.length ?? 0,
    },
  };
}

async function planConfigportOverlay(
  options: ApplyConfigportOverlayOptions,
  planOptions: PlanConfigportOverlayOptions,
): Promise<PlannedConfigportOverlay> {
  const diagnostics: Diagnostic[] = [];
  const stateResult = await readConfigportState(options.stateRootPath);

  if (stateResult.status === "error") {
    diagnostics.push(...stateResult.diagnostics);
  }

  diagnostics.push(...validateSelector(options, options.stateRootPath));
  diagnostics.push(...validateGeneratedOutputPaths(options.generatedPath, options.outputPath));

  const overlay = stateResult.state.overlays.find((candidate) =>
    sameOverlaySelector(candidate, options),
  );

  if (overlay) {
    diagnostics.push(...validateOverlay(overlay, configportStatePath(options.stateRootPath)));
  }

  const generatedFiles = diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? []
    : await collectGeneratedFiles(options.generatedPath, options.generatedPath, diagnostics);
  const writes: PlannedWrite[] = [];

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    for (const generatedFile of generatedFiles) {
      const content = applyReplacements(
        await readFile(generatedFile.sourcePath, "utf8"),
        overlay?.replacements ?? [],
      );
      writes.push({
        content,
        path: join(options.outputPath, generatedFile.relativePath),
      });
    }

    for (const fileOverlay of overlay?.files ?? []) {
      replacePlannedWrite(writes, {
        content: fileOverlay.content,
        path: join(options.outputPath, fileOverlay.path),
      });
    }

    diagnostics.push(...(await validatePlannedWrites(writes, planOptions)));
  }

  return {
    diagnostics,
    ...(overlay ? { overlay } : {}),
    writes,
  };
}

/** Materializes selected runtime instruction assets into a target instruction file. */
export async function materializeConfigportInstructions(
  options: MaterializeConfigportInstructionsOptions,
): Promise<MaterializeConfigportInstructionsResult> {
  const diagnostics: Diagnostic[] = [];
  const stateResult = await readConfigportState(options.stateRootPath);
  const files: string[] = [];
  const selectionSelector = {
    pack: options.pack,
    profile: options.profile,
    scope: options.scope,
    target: options.target,
  };

  if (stateResult.status === "error") {
    diagnostics.push(...stateResult.diagnostics);
  }

  diagnostics.push(
    ...validateInstructionSelectionSelector(selectionSelector, options.stateRootPath),
  );

  const selection = stateResult.state.instructionSelections.find((candidate) =>
    sameInstructionSelection(candidate, selectionSelector),
  );

  if (!selection) {
    diagnostics.push({
      code: "missing-configport-instruction-selection",
      message: "No configport instruction selection matches this profile, target, pack, and scope.",
      path: options.stateRootPath,
      severity: "error",
    });
  } else {
    diagnostics.push(
      ...validateInstructionSelection(selection, configportStatePath(options.stateRootPath)),
    );
  }

  const discovery = diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? undefined
    : await discoverPackRepository(options.packRootPath);

  if (discovery) {
    diagnostics.push(...discovery.diagnostics);
  }

  const pack = discovery?.index.packs.find((candidate) => candidate.id === options.pack);

  if (discovery && !pack) {
    diagnostics.push({
      code: "missing-configport-instruction-pack",
      message: `Selected instruction pack was not found: ${options.pack}.`,
      path: options.packRootPath,
      severity: "error",
    });
  }

  const renderedInstructions =
    selection && pack && !diagnostics.some((diagnostic) => diagnostic.severity === "error")
      ? await renderSelectedInstructions(selection, pack.assets, diagnostics)
      : [];

  const targetPath = join(options.outputPath, instructionTargetRelativePath(options.target));
  const writes: PlannedWrite[] = [];

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error") && selection) {
    const existingContent = await readExistingInstructionTarget(targetPath, diagnostics);
    const managedBlock = formatManagedInstructionBlock(selection, renderedInstructions);
    const mergedContent =
      existingContent === undefined
        ? undefined
        : mergeManagedInstructionBlock(
            existingContent,
            managedBlock,
            selection,
            targetPath,
            diagnostics,
          );

    if (mergedContent !== undefined) {
      writes.push({ content: mergedContent, path: targetPath });
    }

    diagnostics.push(...(await validatePlannedWrites(writes)));
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    for (const write of writes) {
      await writeMaterializedFile(write.path, write.content);
      files.push(write.path);
    }
  }

  return {
    diagnostics,
    files,
    outputPath: options.outputPath,
    summary: {
      files: files.length,
      instructions: renderedInstructions.length,
    },
  };
}

/** Formats configport diagnostics for CLI surfaces and control skills. */
export function formatConfigportDiagnostics(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "No configport issues found.";
  }

  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`,
    )
    .join("\n");
}

function configportStatePath(stateRootPath: string): string {
  return join(stateRootPath, CONFIGPORT_STATE_FILE);
}

function emptyConfigportState(): ConfigportState {
  return { instructionSelections: [], overlays: [], stateVersion: 1 };
}

function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function normalizeOverlay(overlay: ConfigportOverlay): ConfigportOverlay {
  return {
    files: [...overlay.files].sort((left, right) => compareStrings(left.path, right.path)),
    pack: overlay.pack,
    profile: overlay.profile,
    replacements: [...overlay.replacements].sort((left, right) =>
      compareStrings(left.from, right.from),
    ),
    target: overlay.target,
  };
}

function normalizeInstructionSelection(
  selection: ConfigportInstructionSelection,
): ConfigportInstructionSelection {
  return {
    answers: sortRecord(selection.answers),
    instructions: [...selection.instructions],
    pack: selection.pack,
    profile: selection.profile,
    scope: selection.scope,
    target: selection.target,
  };
}

function sortRecord(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => compareStrings(left, right)),
  );
}

function validateOverlay(overlay: ConfigportOverlay, path: string): Diagnostic[] {
  const diagnostics = validateSelector(overlay, path);

  for (const replacement of overlay.replacements) {
    if (replacement.from === "") {
      diagnostics.push({
        code: "invalid-configport-replacement",
        message: "Replacement source text must not be empty.",
        path,
        severity: "error",
      });
    }
  }

  const filePaths = new Set<string>();

  for (const file of overlay.files) {
    if (filePaths.has(file.path)) {
      diagnostics.push({
        code: "duplicate-configport-overlay-path",
        message: `Overlay file path is declared more than once: ${file.path}.`,
        path,
        severity: "error",
      });
      continue;
    }

    filePaths.add(file.path);

    if (!isSafeRelativePath(file.path)) {
      diagnostics.push({
        code: "invalid-configport-overlay-path",
        message: `Overlay file path must stay inside the materialized output: ${file.path}.`,
        path,
        severity: "error",
      });
    }
  }

  return diagnostics;
}

function validateInstructionSelection(
  selection: ConfigportInstructionSelection,
  path: string,
): Diagnostic[] {
  const diagnostics = validateInstructionSelectionSelector(selection, path);

  if (selection.instructions.length === 0) {
    diagnostics.push({
      code: "missing-configport-instructions",
      message: "Instruction selection must include at least one instruction asset.",
      path,
      severity: "error",
    });
  }

  const instructionNames = new Set<string>();

  for (const instruction of selection.instructions) {
    if (instructionNames.has(instruction)) {
      diagnostics.push({
        code: "duplicate-configport-instruction",
        message: `Instruction asset is selected more than once: ${instruction}.`,
        path,
        severity: "error",
      });
      continue;
    }

    instructionNames.add(instruction);

    if (!isSafeInstructionName(instruction)) {
      diagnostics.push({
        code: "invalid-configport-instruction",
        message: `Instruction asset name must be a single safe path segment: ${instruction}.`,
        path,
        severity: "error",
      });
    }
  }

  for (const key of Object.keys(selection.answers)) {
    if (!CONFIG_REF_NAME_PATTERN.test(key)) {
      diagnostics.push({
        code: "invalid-configport-answer",
        message: `Config answer key must match config ref syntax: ${key}.`,
        path,
        severity: "error",
      });
    }
  }

  return diagnostics;
}

function validateInstructionSelectionSelector(
  selector: Pick<ConfigportInstructionSelection, "pack" | "profile" | "scope" | "target">,
  path: string,
): Diagnostic[] {
  const diagnostics = validateSelector(selector, path);

  if (!HARNESS_TARGETS.has(selector.target)) {
    diagnostics.push({
      code: "unsupported-configport-instruction-target",
      message: `Instruction target is not supported: ${selector.target}.`,
      path,
      severity: "error",
    });
  }

  if (!INSTRUCTION_SCOPES.has(selector.scope)) {
    diagnostics.push({
      code: "unsupported-configport-instruction-scope",
      message: `Instruction scope is not supported: ${selector.scope}.`,
      path,
      severity: "error",
    });
  }

  return diagnostics;
}

function replacePlannedWrite(writes: PlannedWrite[], write: PlannedWrite): void {
  const existingIndex = writes.findIndex((candidate) => candidate.path === write.path);

  if (existingIndex !== -1) {
    writes.splice(existingIndex, 1);
  }

  writes.push(write);
}

function validateSelector(selector: ConfigportOverlaySelector, path: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [key, value] of Object.entries(selector)) {
    if (value === "") {
      diagnostics.push({
        code: "invalid-configport-selector",
        message: `${key} must not be empty.`,
        path,
        severity: "error",
      });
    }
  }

  return diagnostics;
}

function validateGeneratedOutputPaths(generatedPath: string, outputPath: string): Diagnostic[] {
  const resolvedGeneratedPath = resolve(generatedPath);
  const resolvedOutputPath = resolve(outputPath);

  if (
    resolvedOutputPath === resolvedGeneratedPath ||
    isSameOrInside(resolvedOutputPath, resolvedGeneratedPath)
  ) {
    return [
      {
        code: "invalid-configport-output-path",
        message: "Configport output path must not be the generated package path or inside it.",
        path: outputPath,
        severity: "error",
      },
    ];
  }

  return [];
}

function sameOverlaySelector(
  left: ConfigportOverlaySelector,
  right: ConfigportOverlaySelector,
): boolean {
  return left.profile === right.profile && left.target === right.target && left.pack === right.pack;
}

function sameInstructionSelection(
  left: Pick<ConfigportInstructionSelection, "pack" | "profile" | "scope" | "target">,
  right: Pick<ConfigportInstructionSelection, "pack" | "profile" | "scope" | "target">,
): boolean {
  return (
    left.profile === right.profile &&
    left.target === right.target &&
    left.pack === right.pack &&
    left.scope === right.scope
  );
}

function compareOverlays(left: ConfigportOverlay, right: ConfigportOverlay): number {
  return (
    compareStrings(left.profile, right.profile) ||
    compareStrings(left.target, right.target) ||
    compareStrings(left.pack, right.pack)
  );
}

function compareInstructionSelections(
  left: ConfigportInstructionSelection,
  right: ConfigportInstructionSelection,
): number {
  return (
    compareStrings(left.profile, right.profile) ||
    compareStrings(left.target, right.target) ||
    compareStrings(left.pack, right.pack) ||
    compareStrings(left.scope, right.scope)
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function normalizeConfigportState(value: unknown): ConfigportState | undefined {
  if (
    !isRecord(value) ||
    value.stateVersion !== 1 ||
    !Array.isArray(value.overlays) ||
    !value.overlays.every(isConfigportOverlay)
  ) {
    return undefined;
  }

  const instructionSelections = value.instructionSelections;

  if (
    instructionSelections !== undefined &&
    (!Array.isArray(instructionSelections) ||
      !instructionSelections.every(isConfigportInstructionSelection))
  ) {
    return undefined;
  }

  return {
    instructionSelections: instructionSelections ?? [],
    overlays: value.overlays,
    stateVersion: 1,
  };
}

function isConfigportOverlay(value: unknown): value is ConfigportOverlay {
  return (
    isRecord(value) &&
    typeof value.profile === "string" &&
    typeof value.target === "string" &&
    typeof value.pack === "string" &&
    Array.isArray(value.replacements) &&
    value.replacements.every(isConfigportReplacement) &&
    Array.isArray(value.files) &&
    value.files.every(isConfigportFileOverlay)
  );
}

function isConfigportInstructionSelection(value: unknown): value is ConfigportInstructionSelection {
  return (
    isRecord(value) &&
    typeof value.profile === "string" &&
    isHarnessTarget(value.target) &&
    typeof value.pack === "string" &&
    isInstructionScope(value.scope) &&
    Array.isArray(value.instructions) &&
    value.instructions.every((instruction) => typeof instruction === "string") &&
    isStringRecord(value.answers)
  );
}

function isConfigportReplacement(value: unknown): value is ConfigportReplacement {
  return isRecord(value) && typeof value.from === "string" && typeof value.to === "string";
}

function isConfigportFileOverlay(value: unknown): value is ConfigportFileOverlay {
  return isRecord(value) && typeof value.path === "string" && typeof value.content === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isHarnessTarget(value: unknown): value is HarnessTarget {
  return typeof value === "string" && HARNESS_TARGETS.has(value as HarnessTarget);
}

function isInstructionScope(value: unknown): value is ConfigportInstructionScope {
  return typeof value === "string" && INSTRUCTION_SCOPES.has(value as ConfigportInstructionScope);
}

type RenderedInstruction = {
  readonly content: string;
  readonly name: string;
};

async function renderSelectedInstructions(
  selection: ConfigportInstructionSelection,
  assets: readonly AssetIndex[],
  diagnostics: Diagnostic[],
): Promise<RenderedInstruction[]> {
  const renderedInstructions: RenderedInstruction[] = [];

  for (const instructionName of selection.instructions) {
    const asset = assets.find(
      (candidate) => candidate.kind === "instruction" && candidate.name === instructionName,
    );

    if (!asset) {
      diagnostics.push({
        code: "missing-configport-instruction",
        message: `Selected instruction asset was not found: ${instructionName}.`,
        path: selection.pack,
        severity: "error",
      });
      continue;
    }

    const rendered = await renderInstructionAsset(selection, asset, diagnostics);

    if (rendered !== undefined) {
      renderedInstructions.push({ content: rendered, name: instructionName });
    }
  }

  return renderedInstructions;
}

async function renderInstructionAsset(
  selection: ConfigportInstructionSelection,
  asset: AssetIndex,
  diagnostics: Diagnostic[],
): Promise<string | undefined> {
  const renderedPayloads: string[] = [];

  for (const payloadPath of asset.payloadPaths) {
    const text = await readFile(payloadPath, "utf8");
    const scanned = scanPortableRefs(payloadPath, text);
    const rendered = renderPortableRefsForTarget(
      text,
      scanned.refs,
      selection.target,
      selection.answers,
    );

    diagnostics.push(...scanned.diagnostics, ...rendered.diagnostics);

    if (rendered.text !== text || scanned.refs.length > 0) {
      diagnostics.push(...validateNoPortableRefsRemain(payloadPath, rendered.text));
    }

    renderedPayloads.push(rendered.text.trimEnd());
  }

  return renderedPayloads.join("\n\n");
}

function validateNoPortableRefsRemain(path: string, text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const scanned = scanPortableRefs(path, text);

  diagnostics.push(...scanned.diagnostics);

  for (const ref of scanned.refs) {
    diagnostics.push({
      code: "unresolved-configport-instruction-ref",
      message: `Rendered instruction still contains portable ref '${ref.raw}'.`,
      path,
      severity: "error",
    });
  }

  return diagnostics;
}

async function readExistingInstructionTarget(
  targetPath: string,
  diagnostics: Diagnostic[],
): Promise<string | undefined> {
  try {
    await assertPathDoesNotContainSymlinks(targetPath);
    const stats = await lstat(targetPath);

    if (!stats.isFile()) {
      diagnostics.push({
        code: "unwritable-configport-output-path",
        message: "Instruction target path must be a file when it already exists.",
        path: targetPath,
        severity: "error",
      });
      return undefined;
    }

    return await readFile(targetPath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return "";
    }

    diagnostics.push({
      code: isSymlinkPathError(error)
        ? "unsafe-configport-output-path"
        : "unwritable-configport-output-path",
      message:
        error instanceof Error ? error.message : "Instruction target path could not be validated.",
      path: targetPath,
      severity: "error",
    });
    return undefined;
  }
}

function formatManagedInstructionBlock(
  selection: ConfigportInstructionSelection,
  instructions: readonly RenderedInstruction[],
): string {
  const chunks = instructions.flatMap((instruction) => [
    `<!-- packport-source: ${selection.pack}/instruction/${instruction.name} -->`,
    instruction.content,
  ]);

  return [
    managedInstructionStart(selection),
    `<!-- packport-profile: ${selection.profile} -->`,
    `<!-- packport-target: ${selection.target} -->`,
    `<!-- packport-scope: ${selection.scope} -->`,
    "",
    ...chunks,
    managedInstructionEnd(selection),
    "",
  ].join("\n");
}

function mergeManagedInstructionBlock(
  existingContent: string,
  managedBlock: string,
  selection: ConfigportInstructionSelection,
  targetPath: string,
  diagnostics: Diagnostic[],
): string | undefined {
  const start = managedInstructionStart(selection);
  const end = managedInstructionEnd(selection);
  const startIndex = existingContent.indexOf(start);
  const endIndex = existingContent.indexOf(end);

  if (startIndex === -1 && endIndex === -1) {
    if (existingContent === "") {
      return managedBlock;
    }

    const separator = existingContent.endsWith("\n\n")
      ? ""
      : existingContent.endsWith("\n")
        ? "\n"
        : "\n\n";

    return `${existingContent}${separator}${managedBlock}`;
  }

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    diagnostics.push({
      code: "invalid-configport-managed-block",
      message: "Existing instruction target has an incomplete packport managed block.",
      path: targetPath,
      severity: "error",
    });
    return undefined;
  }

  return `${existingContent.slice(0, startIndex)}${managedBlock}${existingContent.slice(
    endIndex + end.length,
  )}`;
}

function managedInstructionStart(selection: ConfigportInstructionSelection): string {
  return `<!-- packport-managed-instructions:${managedInstructionId(selection)}:start -->`;
}

function managedInstructionEnd(selection: ConfigportInstructionSelection): string {
  return `<!-- packport-managed-instructions:${managedInstructionId(selection)}:end -->`;
}

function managedInstructionId(selection: ConfigportInstructionSelection): string {
  return [selection.profile, selection.target, selection.pack, selection.scope]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

function instructionTargetRelativePath(target: HarnessTarget): string {
  return target === "claude" ? "CLAUDE.md" : "AGENTS.md";
}

type GeneratedFile = {
  readonly relativePath: string;
  readonly sourcePath: string;
};

async function collectGeneratedFiles(
  rootPath: string,
  currentPath: string,
  diagnostics: Diagnostic[],
): Promise<GeneratedFile[]> {
  let stats: Awaited<ReturnType<typeof lstat>>;

  try {
    await assertPathDoesNotContainSymlinks(currentPath);
    stats = await lstat(currentPath);
  } catch (_error) {
    diagnostics.push({
      code: isSymlinkPathError(_error)
        ? "unsafe-configport-generated-path"
        : "missing-configport-generated-path",
      message:
        _error instanceof Error && isSymlinkPathError(_error)
          ? _error.message
          : "Generated pack output path does not exist.",
      path: currentPath,
      severity: "error",
    });
    return [];
  }

  if (stats.isSymbolicLink()) {
    diagnostics.push({
      code: "unsafe-configport-generated-path",
      message: "Generated pack output must not contain symlinks.",
      path: currentPath,
      severity: "error",
    });
    return [];
  }

  if (stats.isFile()) {
    const relativePath = relative(rootPath, currentPath);

    if (!isSafeRelativePath(relativePath)) {
      diagnostics.push({
        code: "invalid-configport-generated-path",
        message: "Generated file path must stay inside generated pack output.",
        path: currentPath,
        severity: "error",
      });
      return [];
    }

    return [{ relativePath, sourcePath: currentPath }];
  }

  if (!stats.isDirectory()) {
    diagnostics.push({
      code: "unsupported-configport-generated-entry",
      message: "Generated pack output entries must be files or directories.",
      path: currentPath,
      severity: "warning",
    });
    return [];
  }

  const files: GeneratedFile[] = [];
  const entries = (await readdir(currentPath, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  for (const entry of entries) {
    files.push(
      ...(await collectGeneratedFiles(rootPath, join(currentPath, entry.name), diagnostics)),
    );
  }

  return files;
}

function applyReplacements(
  content: string,
  replacements: readonly ConfigportReplacement[],
): string {
  let nextContent = content;

  for (const replacement of replacements) {
    nextContent = nextContent.split(replacement.from).join(replacement.to);
  }

  return nextContent;
}

async function validatePlannedWrites(
  writes: readonly PlannedWrite[],
  options: PlanConfigportOverlayOptions = { checkWritablePaths: true },
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const paths = new Set<string>();
  const absolutePaths: string[] = [];

  for (const write of writes) {
    const absolutePath = resolve(write.path);

    if (paths.has(absolutePath)) {
      diagnostics.push({
        code: "configport-target-collision",
        message: "Multiple configport overlay writes target the same path.",
        path: write.path,
        severity: "error",
      });
      continue;
    }

    const conflictingPath = absolutePaths.find(
      (candidate) =>
        isSameOrInside(absolutePath, candidate) || isSameOrInside(candidate, absolutePath),
    );

    if (conflictingPath !== undefined) {
      diagnostics.push({
        code: "configport-target-path-collision",
        message: "Configport output paths must not be ancestors or descendants of each other.",
        path: write.path,
        severity: "error",
      });
      continue;
    }

    paths.add(absolutePath);
    absolutePaths.push(absolutePath);

    if (options.checkWritablePaths) {
      try {
        await assertWritableFilePath(write.path);
      } catch (error) {
        diagnostics.push({
          code: isSymlinkPathError(error)
            ? "unsafe-configport-output-path"
            : "unwritable-configport-output-path",
          message:
            error instanceof Error
              ? error.message
              : "Materialized configport output path could not be validated.",
          path: write.path,
          severity: "error",
        });
      }
    }
  }

  return diagnostics;
}

async function writeMaterializedFile(path: string, content: string): Promise<void> {
  await assertWritableFilePath(path);
  await mkdir(dirname(path), { recursive: true });
  await assertWritableFilePath(path);
  await writeFile(path, content, "utf8");
}

async function readMaterializedFileForCheck(
  path: string,
  diagnostics: Diagnostic[],
): Promise<string | undefined> {
  try {
    await assertPathDoesNotContainSymlinks(path);
    const stats = await lstat(path);

    if (!stats.isFile()) {
      diagnostics.push({
        code: "invalid-configport-output",
        message: "Materialized configport output path must be a regular file.",
        path,
        severity: "error",
      });
      return undefined;
    }

    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      diagnostics.push({
        code: "missing-configport-output",
        message: "Materialized configport output file is missing.",
        path,
        severity: "error",
      });
      return undefined;
    }

    diagnostics.push({
      code: isSymlinkPathError(error)
        ? "unsafe-configport-output-path"
        : "unreadable-configport-output",
      message:
        error instanceof Error
          ? error.message
          : "Materialized configport output could not be read.",
      path,
      severity: "error",
    });
    return undefined;
  }
}

async function assertWritableFilePath(path: string): Promise<void> {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const relativePath = absolutePath.slice(root.length);
  const segments = relativePath.split(/[\\/]+/).filter((segment) => segment !== "");
  let currentPath = root;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (segment === undefined) {
      continue;
    }

    currentPath = join(currentPath, segment);

    try {
      const stats = await lstat(currentPath);

      if (stats.isSymbolicLink()) {
        throw new Error(`configport path must not contain symlinks: ${currentPath}`);
      }

      const isLast = index === segments.length - 1;

      if (!isLast && !stats.isDirectory()) {
        throw new Error(`configport output parent path must be a directory: ${currentPath}`);
      }

      if (isLast && stats.isDirectory()) {
        throw new Error(`configport output file path is an existing directory: ${currentPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }
  }
}

function isSafeRelativePath(value: string): boolean {
  const segments = value.split(/[\\/]+/);

  return (
    value !== "" &&
    value !== "." &&
    !isAbsolute(value) &&
    !value.includes("\\") &&
    !segments.some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

function isSafeInstructionName(value: string): boolean {
  return isSafeRelativePath(value) && !value.includes("/");
}

function isSameOrInside(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}${sep}`);
}

async function assertPathDoesNotContainSymlinks(path: string): Promise<void> {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const relativePath = absolutePath.slice(root.length);
  let currentPath = root;

  for (const segment of relativePath.split(/[\\/]+/)) {
    if (segment === "") {
      continue;
    }

    currentPath = join(currentPath, segment);

    try {
      const stats = await lstat(currentPath);

      if (stats.isSymbolicLink()) {
        throw new Error(`configport path must not contain symlinks: ${currentPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isSymlinkPathError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith("configport path must not contain symlinks:")
  );
}
