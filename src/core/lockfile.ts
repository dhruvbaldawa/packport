// ABOUTME: Reads, writes, and validates packport's generated pack.lock.yaml file.
// ABOUTME: Keeps generated ownership and source drift separate from author-facing source.

import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { parse, stringify } from "yaml";
import type { Diagnostic, PackRepositoryIndex } from "./types";

export const PACK_LOCK_FILE = "pack.lock.yaml";
const CODEX_MCP_BLOCK_START = "# packport-managed-codex-mcp:start";
const CODEX_MCP_BLOCK_END = "# packport-managed-codex-mcp:end";

export type LockedAsset = {
  readonly contract?: LockedSource;
  readonly id: string;
  readonly kind: string;
  readonly payloads: readonly LockedSource[];
  readonly support?: readonly LockedSource[];
};

export type LockedPack = {
  readonly hash: string;
  readonly id: string;
  readonly path: string;
  readonly support?: readonly LockedSource[];
  readonly version: string;
};

export type LockedSource = {
  readonly hash: string;
  readonly path: string;
};

export type GeneratedOutput = {
  readonly kind: "config" | "marketplace" | "package";
  readonly packageName?: string;
  readonly path: string;
  readonly target: string;
};

export type PreservedOutput = GeneratedOutput & {
  readonly hash: string;
};

export type LockedOutput = {
  readonly hash: string;
  readonly kind: "config" | "marketplace" | "package";
  readonly packageName?: string;
  readonly path: string;
  readonly target: string;
};

export type PackLock = {
  readonly assets: readonly LockedAsset[];
  readonly decisions: readonly string[];
  readonly lockfileVersion: 1;
  readonly outputs: readonly LockedOutput[];
  readonly packs: readonly LockedPack[];
  readonly tool: {
    readonly name: "packport";
    readonly version: string;
  };
};

export type PackLockReadResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly lock?: PackLock;
};

/** Builds a deterministic lockfile from a discovered pack repository index. */
export async function createPackLock(
  rootPath: string,
  index: PackRepositoryIndex,
  toolVersion: string,
  outputs: readonly (GeneratedOutput | PreservedOutput)[] = [],
  decisions: readonly string[] = [],
): Promise<PackLock> {
  const packs = await Promise.all(
    index.packs.map(async (pack) => ({
      hash: await hashSourceFile(rootPath, pack.packFilePath),
      id: pack.id,
      path: relativePath(rootPath, pack.packFilePath),
      ...(pack.supportPaths.length > 0
        ? {
            support: await Promise.all(
              pack.supportPaths.map(async (supportPath) => ({
                hash: await hashSourceFile(rootPath, supportPath),
                path: relativePath(rootPath, supportPath),
              })),
            ),
          }
        : {}),
      version: pack.version,
    })),
  );
  const assets = await Promise.all(
    index.packs.flatMap((pack) =>
      pack.assets.map(async (asset) => ({
        ...(asset.contract
          ? {
              contract: {
                hash: await hashSourceFile(rootPath, asset.contract.path),
                path: relativePath(rootPath, asset.contract.path),
              },
            }
          : {}),
        id: asset.id,
        kind: asset.kind,
        payloads: await Promise.all(
          asset.payloadPaths.map(async (payloadPath) => ({
            hash: await hashSourceFile(rootPath, payloadPath),
            path: relativePath(rootPath, payloadPath),
          })),
        ),
        ...(asset.supportPaths.length > 0
          ? {
              support: await Promise.all(
                asset.supportPaths.map(async (supportPath) => ({
                  hash: await hashSourceFile(rootPath, supportPath),
                  path: relativePath(rootPath, supportPath),
                })),
              ),
            }
          : {}),
      })),
    ),
  );

  return {
    assets,
    decisions,
    lockfileVersion: 1,
    outputs: await lockGeneratedOutputs(rootPath, outputs),
    packs,
    tool: { name: "packport", version: toolVersion },
  };
}

/** Regenerates and writes pack.lock.yaml after a successful target generation run. */
export async function writePackGenerationLock(
  rootPath: string,
  index: PackRepositoryIndex,
  toolVersion: string,
  outputs: readonly GeneratedOutput[],
  target: string,
  decisions: readonly string[] = [],
  previousOutputs: readonly LockedOutput[] = [],
): Promise<PackLock> {
  const lock = await createPackLock(
    rootPath,
    index,
    toolVersion,
    [...previousOutputs.filter((output) => output.target !== target), ...outputs],
    decisions,
  );
  await writePackLock(rootPath, lock);
  return lock;
}

/** Regenerates pack.lock.yaml while replacing one generated package's output ownership. */
export async function writePackGenerationPackageLock(
  rootPath: string,
  index: PackRepositoryIndex,
  toolVersion: string,
  outputs: readonly GeneratedOutput[],
  target: string,
  packageName: string,
  decisions: readonly string[] = [],
  previousOutputs: readonly LockedOutput[] = [],
): Promise<PackLock> {
  const lock = await createPackLock(
    rootPath,
    index,
    toolVersion,
    [
      ...previousOutputs.filter(
        (output) =>
          output.target !== target ||
          output.kind !== "package" ||
          output.packageName !== packageName,
      ),
      ...outputs,
    ],
    decisions,
  );
  await writePackLock(rootPath, lock);
  return lock;
}

/** Regenerates pack.lock.yaml while replacing selected packages and the target marketplace. */
export async function writePackGenerationSelectionLock(
  rootPath: string,
  index: PackRepositoryIndex,
  toolVersion: string,
  outputs: readonly GeneratedOutput[],
  target: string,
  preservedPackageNames: readonly string[],
  decisions: readonly string[] = [],
  previousOutputs: readonly LockedOutput[] = [],
): Promise<PackLock> {
  const preservedPackages = new Set(preservedPackageNames);
  const lock = await createPackLock(
    rootPath,
    index,
    toolVersion,
    [
      ...previousOutputs.filter((output) => {
        if (output.target !== target) {
          return true;
        }

        if (output.kind === "marketplace") {
          return false;
        }

        return output.packageName !== undefined && preservedPackages.has(output.packageName);
      }),
      ...outputs,
    ],
    decisions,
  );
  await writePackLock(rootPath, lock);
  return lock;
}

/** Refreshes one already-locked generated output hash after another generator rewrites it. */
export async function refreshPackLockGeneratedOutput(
  rootPath: string,
  lock: PackLock,
  output: GeneratedOutput,
): Promise<PackLock> {
  const path = relativePath(rootPath, output.path);

  if (!isValidLockPath(path)) {
    throw new Error(`Generated output path must stay inside the repository: ${output.path}`);
  }

  const state = await tryHashLockedOutput(rootPath, { ...output, path });
  const hash = state.hash;

  if (!hash) {
    throw new Error(
      state.diagnostic?.message ?? `Cannot hash unsafe or missing generated output: ${path}`,
    );
  }

  return {
    ...lock,
    outputs: lock.outputs.map((lockedOutput) => {
      if (
        lockedOutput.target !== output.target ||
        lockedOutput.kind !== output.kind ||
        lockedOutput.path !== path
      ) {
        return lockedOutput;
      }

      return {
        hash,
        kind: output.kind,
        ...(output.packageName ? { packageName: output.packageName } : {}),
        path,
        target: output.target,
      };
    }),
  };
}

/** Reports source files that changed, disappeared, or are not tracked by the lockfile. */
export async function detectLockDrift(
  rootPath: string,
  lock: PackLock,
  index: PackRepositoryIndex,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const lockedPaths = new Set(lockedSources(lock).map((source) => source.path));

  for (const source of lockedSources(lock)) {
    const absolutePath = join(rootPath, source.path);
    const sourceState = await tryHashLockedSource(rootPath, source.path);

    if (sourceState.diagnostic) {
      diagnostics.push(sourceState.diagnostic);
      continue;
    }

    if (sourceState.hash === undefined) {
      diagnostics.push({
        code: "missing-locked-source",
        message: "Locked source file is missing.",
        path: absolutePath,
        severity: "error",
      });
      continue;
    }

    if (sourceState.hash !== source.hash) {
      diagnostics.push({
        code: "source-drift",
        message: "Locked source file hash differs from current contents.",
        path: absolutePath,
        severity: "error",
      });
    }
  }

  for (const output of lock.outputs) {
    const absolutePath = join(rootPath, output.path);
    const outputState = await tryHashLockedOutput(rootPath, output);

    if (outputState.diagnostic) {
      diagnostics.push(outputState.diagnostic);
      continue;
    }

    if (outputState.hash === undefined) {
      diagnostics.push({
        code: "missing-locked-output",
        message: "Locked generated output file is missing.",
        path: absolutePath,
        severity: "error",
      });
      continue;
    }

    if (outputState.hash !== output.hash) {
      diagnostics.push({
        code: "output-drift",
        message: "Locked generated output hash differs from current contents.",
        path: absolutePath,
        severity: "error",
      });
    }
  }

  for (const source of indexSources(rootPath, index)) {
    if (!lockedPaths.has(source.path)) {
      diagnostics.push({
        code: "unlocked-source",
        message: "Source file is not recorded in pack.lock.yaml.",
        path: join(rootPath, source.path),
        severity: "error",
      });
    }
  }

  return diagnostics;
}

/** Reads and validates pack.lock.yaml when it exists. */
export async function readPackLock(rootPath: string): Promise<PackLockReadResult> {
  const lockPath = join(rootPath, PACK_LOCK_FILE);

  try {
    return validatePackLock(parse(await readFile(lockPath, "utf8")), lockPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return { diagnostics: [] };
    }

    return {
      diagnostics: [
        {
          code: "invalid-lockfile-yaml",
          message: error instanceof Error ? error.message : "Could not parse pack.lock.yaml.",
          path: lockPath,
          severity: "error",
        },
      ],
    };
  }
}

/** Serializes and writes pack.lock.yaml deterministically. */
export async function writePackLock(rootPath: string, lock: PackLock): Promise<void> {
  await writeFile(join(rootPath, PACK_LOCK_FILE), serializePackLock(lock));
}

/** Serializes pack.lock.yaml with stable key order and without YAML anchors. */
export function serializePackLock(lock: PackLock): string {
  return stringify(lock, { aliasDuplicateObjects: false, collectionStyle: "block" });
}

/** Hashes a file with SHA-256 for lockfile drift checks. */
async function hashFile(path: string): Promise<string> {
  return hashContent(await readFile(path));
}

/** Hashes bytes or text with SHA-256 for lockfile drift checks. */
function hashContent(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Hashes a source path only after enforcing the same safety checks used for drift. */
async function hashSourceFile(rootPath: string, path: string): Promise<string> {
  const relativeSourcePath = relativePath(rootPath, path);
  const sourceState = await tryHashLockedPath(rootPath, relativeSourcePath, "source");

  if (sourceState.hash) {
    return sourceState.hash;
  }

  throw new Error(
    sourceState.diagnostic?.message ?? `Cannot hash unsafe or missing source file: ${path}`,
  );
}

type LockedSourceState = {
  readonly diagnostic?: Diagnostic;
  readonly hash?: string;
};

/** Attempts to hash a locked source, converting unsafe or unreadable paths to diagnostics. */
async function tryHashLockedSource(
  rootPath: string,
  sourcePath: string,
): Promise<LockedSourceState> {
  return await tryHashLockedPath(rootPath, sourcePath, "source");
}

/** Attempts to hash a locked generated output, using managed-block ownership for config files. */
async function tryHashLockedOutput(
  rootPath: string,
  output: Pick<LockedOutput, "kind" | "path" | "target">,
): Promise<LockedSourceState> {
  if (output.kind === "config" && output.target === "codex") {
    return await tryHashLockedPath(
      rootPath,
      output.path,
      "output",
      hashCodexMcpManagedBlock,
      "Locked generated config output is missing the packport-managed Codex MCP block.",
    );
  }

  return await tryHashLockedPath(rootPath, output.path, "output");
}

/** Attempts to hash one locked path, converting unsafe or unreadable paths to diagnostics. */
async function tryHashLockedPath(
  rootPath: string,
  lockPath: string,
  kind: "output" | "source",
  hashPath: (path: string) => Promise<string | undefined> = hashFile,
  missingHashMessage?: string,
): Promise<LockedSourceState> {
  const path = join(rootPath, lockPath);
  const label = kind === "source" ? "source" : "generated output";
  const code = kind === "source" ? "invalid-locked-source" : "invalid-locked-output";

  if (!isValidLockPath(lockPath)) {
    return {
      diagnostic: {
        code,
        message: `Locked ${label} path must be relative and stay inside the repository.`,
        path,
        severity: "error",
      },
    };
  }

  try {
    const stats = await lstatSourcePath(rootPath, lockPath);

    if (!stats.isFile()) {
      return {
        diagnostic: {
          code,
          message: `Locked ${label} path must be a regular file.`,
          path,
          severity: "error",
        },
      };
    }

    const hash = await hashPath(path);

    if (hash === undefined) {
      return {
        diagnostic: {
          code,
          message:
            missingHashMessage ?? `Locked ${label} path must contain hashable generated content.`,
          path,
          severity: "error",
        },
      };
    }

    return { hash };
  } catch (error) {
    if (error instanceof SymlinkSourceError) {
      return {
        diagnostic: {
          code,
          message: `Locked ${label} path must not contain symlinks.`,
          path: error.path,
          severity: "error",
        },
      };
    }

    if (isMissingPathError(error)) {
      return {};
    }

    return {
      diagnostic: {
        code: kind === "source" ? "unreadable-locked-source" : "unreadable-locked-output",
        message:
          error instanceof Error
            ? error.message
            : `Could not read locked ${kind === "source" ? "source" : "generated output"} file.`,
        path,
        severity: "error",
      },
    };
  }
}

/** Hashes generated outputs that are inside the repository and safe to record. */
async function lockGeneratedOutputs(
  rootPath: string,
  outputs: readonly (GeneratedOutput | PreservedOutput)[],
): Promise<LockedOutput[]> {
  const lockedOutputs: LockedOutput[] = [];

  for (const output of outputs) {
    const path = "hash" in output ? output.path : relativePath(rootPath, output.path);

    if (!isValidLockPath(path)) {
      throw new Error(`Generated output path must stay inside the repository: ${output.path}`);
    }

    const hash = "hash" in output ? output.hash : undefined;
    const state =
      hash === undefined
        ? await tryHashLockedOutput(rootPath, { kind: output.kind, path, target: output.target })
        : { hash };

    if (!state.hash) {
      throw new Error(
        state.diagnostic?.message ?? `Cannot hash unsafe or missing generated output: ${path}`,
      );
    }

    lockedOutputs.push({
      hash: state.hash,
      kind: output.kind,
      ...(output.packageName ? { packageName: output.packageName } : {}),
      path,
      target: output.target,
    });
  }

  return lockedOutputs.sort((left, right) => left.path.localeCompare(right.path));
}

async function hashCodexMcpManagedBlock(path: string): Promise<string | undefined> {
  const content = await readFile(path, "utf8");
  const start = content.indexOf(CODEX_MCP_BLOCK_START);
  const end = content.indexOf(CODEX_MCP_BLOCK_END);

  if (start === -1 || end === -1 || end < start) {
    return undefined;
  }

  return hashContent(content.slice(start, end + CODEX_MCP_BLOCK_END.length));
}

/** Lstats every component of a locked source path so symlink traversal cannot escape root. */
async function lstatSourcePath(
  rootPath: string,
  sourcePath: string,
): Promise<Awaited<ReturnType<typeof lstat>>> {
  let currentPath = rootPath;
  let currentStats: Awaited<ReturnType<typeof lstat>> | undefined;

  for (const segment of sourcePath.split(/[\\/]+/)) {
    currentPath = join(currentPath, segment);
    currentStats = await lstat(currentPath);

    if (currentStats.isSymbolicLink()) {
      throw new SymlinkSourceError(currentPath);
    }
  }

  if (currentStats === undefined) {
    throw new Error("Locked source path is empty.");
  }

  return currentStats;
}

class SymlinkSourceError extends Error {
  readonly path: string;

  /** Captures the symlink path that made a locked source unsafe. */
  constructor(path: string) {
    super("Locked source path must not contain symlinks.");
    this.path = path;
  }
}

/** Returns every source file tracked by a lockfile. */
function lockedSources(lock: PackLock): LockedSource[] {
  return [
    ...lock.packs.map((pack) => ({ hash: pack.hash, path: pack.path })),
    ...lock.packs.flatMap((pack) => pack.support ?? []),
    ...lock.assets.flatMap((asset) => [
      ...(asset.contract ? [asset.contract] : []),
      ...asset.payloads,
      ...(asset.support ?? []),
    ]),
  ];
}

/** Returns every source path that the current index says should be locked. */
function indexSources(rootPath: string, index: PackRepositoryIndex): LockedSource[] {
  return index.packs.flatMap((pack) => [
    { hash: "", path: relativePath(rootPath, pack.packFilePath) },
    ...pack.supportPaths.map((supportPath) => ({
      hash: "",
      path: relativePath(rootPath, supportPath),
    })),
    ...pack.assets.flatMap((asset) => [
      ...(asset.contract ? [{ hash: "", path: relativePath(rootPath, asset.contract.path) }] : []),
      ...asset.payloadPaths.map((payloadPath) => ({
        hash: "",
        path: relativePath(rootPath, payloadPath),
      })),
      ...asset.supportPaths.map((supportPath) => ({
        hash: "",
        path: relativePath(rootPath, supportPath),
      })),
    ]),
  ]);
}

/** Validates parsed YAML before any lockfile path is trusted. */
function validatePackLock(value: unknown, path: string): PackLockReadResult {
  const diagnostics: Diagnostic[] = [];

  if (!isRecord(value)) {
    return { diagnostics: [invalidLockfile(path, "pack.lock.yaml must contain a mapping.")] };
  }

  const lockfileVersion = value.lockfileVersion;
  const tool = value.tool;
  const packs = value.packs;
  const assets = value.assets;
  const decisions = value.decisions;
  const outputs = value.outputs;

  if (lockfileVersion !== 1) {
    diagnostics.push(invalidLockfile(path, "pack.lock.yaml must have lockfileVersion: 1."));
  }

  if (!isRecord(tool) || tool.name !== "packport" || typeof tool.version !== "string") {
    diagnostics.push(invalidLockfile(path, "pack.lock.yaml tool metadata is invalid."));
  }

  if (!Array.isArray(packs)) {
    diagnostics.push(invalidLockfile(path, "pack.lock.yaml packs must be a list."));
  }

  if (!Array.isArray(assets)) {
    diagnostics.push(invalidLockfile(path, "pack.lock.yaml assets must be a list."));
  }

  if (!Array.isArray(decisions)) {
    diagnostics.push(invalidLockfile(path, "pack.lock.yaml decisions must be a list."));
  }

  if (!Array.isArray(outputs)) {
    diagnostics.push(invalidLockfile(path, "pack.lock.yaml outputs must be a list."));
  }

  const lockedPacks = Array.isArray(packs)
    ? packs.flatMap((pack) => validateLockedPack(pack, path, diagnostics))
    : [];
  const lockedAssets = Array.isArray(assets)
    ? assets.flatMap((asset) => validateLockedAsset(asset, path, diagnostics))
    : [];
  const lockedDecisions = Array.isArray(decisions)
    ? decisions.flatMap((decision) => validateStringEntry(decision, path, diagnostics, "decision"))
    : [];
  const lockedOutputs = Array.isArray(outputs)
    ? outputs.flatMap((output) => validateLockedOutput(output, path, diagnostics))
    : [];

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  return {
    diagnostics: [],
    lock: {
      assets: lockedAssets,
      decisions: lockedDecisions,
      lockfileVersion: 1,
      outputs: lockedOutputs,
      packs: lockedPacks,
      tool: { name: "packport", version: (tool as { version: string }).version },
    },
  };
}

/** Validates one generated output entry from a parsed lockfile. */
function validateLockedOutput(
  value: unknown,
  lockPath: string,
  diagnostics: Diagnostic[],
): LockedOutput[] {
  if (!isRecord(value)) {
    diagnostics.push(invalidLockfile(lockPath, "Locked output entries must be mappings."));
    return [];
  }

  if (
    typeof value.hash !== "string" ||
    !isValidLockPath(value.path) ||
    (value.kind !== "config" && value.kind !== "marketplace" && value.kind !== "package") ||
    typeof value.target !== "string" ||
    (value.packageName !== undefined && typeof value.packageName !== "string")
  ) {
    diagnostics.push(invalidLockfile(lockPath, "Locked output entry is invalid."));
    return [];
  }

  return [
    {
      hash: value.hash,
      kind: value.kind,
      ...(value.packageName ? { packageName: value.packageName } : {}),
      path: value.path,
      target: value.target,
    },
  ];
}

/** Validates one pack entry from a parsed lockfile. */
function validateLockedPack(
  value: unknown,
  lockPath: string,
  diagnostics: Diagnostic[],
): LockedPack[] {
  if (!isRecord(value)) {
    diagnostics.push(invalidLockfile(lockPath, "Locked pack entries must be mappings."));
    return [];
  }

  const supportValue = value.support;

  if (
    typeof value.id !== "string" ||
    typeof value.version !== "string" ||
    typeof value.hash !== "string" ||
    !isValidLockPath(value.path) ||
    (supportValue !== undefined && !Array.isArray(supportValue))
  ) {
    diagnostics.push(invalidLockfile(lockPath, "Locked pack entry is invalid."));
    return [];
  }

  const support =
    supportValue === undefined
      ? undefined
      : supportValue.flatMap((source) => validateLockedSource(source, lockPath, diagnostics));

  return [
    {
      hash: value.hash,
      id: value.id,
      path: value.path,
      ...(support && support.length > 0 ? { support } : {}),
      version: value.version,
    },
  ];
}

/** Validates one asset entry from a parsed lockfile. */
function validateLockedAsset(
  value: unknown,
  lockPath: string,
  diagnostics: Diagnostic[],
): LockedAsset[] {
  if (!isRecord(value)) {
    diagnostics.push(invalidLockfile(lockPath, "Locked asset entries must be mappings."));
    return [];
  }

  const payloads = value.payloads;
  const contract = value.contract;
  const supportValue = value.support;

  if (typeof value.id !== "string" || typeof value.kind !== "string" || !Array.isArray(payloads)) {
    diagnostics.push(invalidLockfile(lockPath, "Locked asset entry is invalid."));
    return [];
  }

  if (supportValue !== undefined && !Array.isArray(supportValue)) {
    diagnostics.push(invalidLockfile(lockPath, "Locked asset support entry is invalid."));
    return [];
  }

  const support =
    supportValue === undefined
      ? undefined
      : supportValue.flatMap((source) => validateLockedSource(source, lockPath, diagnostics));
  const lockedPayloads = payloads.flatMap((payload) =>
    validateLockedSource(payload, lockPath, diagnostics),
  );
  const lockedContract =
    contract === undefined ? undefined : validateLockedSource(contract, lockPath, diagnostics)[0];

  return [
    {
      ...(lockedContract ? { contract: lockedContract } : {}),
      id: value.id,
      kind: value.kind,
      payloads: lockedPayloads,
      ...(support && support.length > 0 ? { support } : {}),
    },
  ];
}

/** Validates one path/hash pair from a parsed lockfile. */
function validateLockedSource(
  value: unknown,
  lockPath: string,
  diagnostics: Diagnostic[],
): LockedSource[] {
  if (!isRecord(value) || typeof value.hash !== "string" || !isValidLockPath(value.path)) {
    diagnostics.push(invalidLockfile(lockPath, "Locked source entry is invalid."));
    return [];
  }

  return [{ hash: value.hash, path: value.path }];
}

/** Validates one string list entry from a parsed lockfile. */
function validateStringEntry(
  value: unknown,
  lockPath: string,
  diagnostics: Diagnostic[],
  field: string,
): string[] {
  if (typeof value !== "string") {
    diagnostics.push(invalidLockfile(lockPath, `Locked ${field} entries must be strings.`));
    return [];
  }

  return [value];
}

/** Builds an invalid-lockfile diagnostic with a stable code. */
function invalidLockfile(path: string, message: string): Diagnostic {
  return { code: "invalid-lockfile", message, path, severity: "error" };
}

/** Checks that a lockfile path is relative and cannot leave the repository. */
function isValidLockPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    !value.includes("\\") &&
    !isAbsolute(value) &&
    !isWindowsAbsolutePath(value) &&
    !value.split(/[\\/]+/).includes("..")
  );
}

/** Checks Windows absolute paths even when packport runs on POSIX. */
function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/** Narrows unknown parsed YAML values to records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Converts an absolute source path into a portable slash-separated lockfile path. */
function relativePath(rootPath: string, path: string): string {
  return relative(rootPath, path).replaceAll("\\", "/");
}

/** Narrows Node filesystem errors that represent missing paths. */
function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
