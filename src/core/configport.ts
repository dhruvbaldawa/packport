// ABOUTME: Manages configport profile overlays for generated agent-pack output.
// ABOUTME: Keeps local customization state outside reusable pack source.

import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import type { Diagnostic } from "./types";

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

export type ConfigportState = {
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

/** Reads persisted configport state, returning an empty state when none exists. */
export async function readConfigportState(
  stateRootPath: string,
): Promise<ReadConfigportStateResult> {
  const statePath = configportStatePath(stateRootPath);

  try {
    await assertPathDoesNotContainSymlinks(statePath);
    const parsed = JSON.parse(await readFile(statePath, "utf8"));

    if (isConfigportState(parsed)) {
      return { state: parsed, status: "ok" };
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
  const state: ConfigportState = { overlays, stateVersion: 1 };

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

/** Applies generated pack output plus a selected local overlay into a materialized output tree. */
export async function applyConfigportOverlay(
  options: ApplyConfigportOverlayOptions,
): Promise<ApplyConfigportOverlayResult> {
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

    diagnostics.push(...(await validatePlannedWrites(writes)));
  }

  const files: string[] = [];

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
      overlays: overlay ? 1 : 0,
      replacements: overlay?.replacements.length ?? 0,
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
  return { overlays: [], stateVersion: 1 };
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

function compareOverlays(left: ConfigportOverlay, right: ConfigportOverlay): number {
  return (
    compareStrings(left.profile, right.profile) ||
    compareStrings(left.target, right.target) ||
    compareStrings(left.pack, right.pack)
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

function isConfigportState(value: unknown): value is ConfigportState {
  return (
    isRecord(value) &&
    value.stateVersion === 1 &&
    Array.isArray(value.overlays) &&
    value.overlays.every(isConfigportOverlay)
  );
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

function isConfigportReplacement(value: unknown): value is ConfigportReplacement {
  return isRecord(value) && typeof value.from === "string" && typeof value.to === "string";
}

function isConfigportFileOverlay(value: unknown): value is ConfigportFileOverlay {
  return isRecord(value) && typeof value.path === "string" && typeof value.content === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

async function validatePlannedWrites(writes: readonly PlannedWrite[]): Promise<Diagnostic[]> {
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

  return diagnostics;
}

async function writeMaterializedFile(path: string, content: string): Promise<void> {
  await assertWritableFilePath(path);
  await mkdir(dirname(path), { recursive: true });
  await assertWritableFilePath(path);
  await writeFile(path, content, "utf8");
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
