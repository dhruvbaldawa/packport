// ABOUTME: Discovers portable packs from packport's convention-based source layout.
// ABOUTME: Builds a lightweight index while keeping payload files opaque.

import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parseMarkdownContract } from "./markdown";
import type { AssetIndex, AssetKind, Diagnostic, DiscoveryResult, PackIndex } from "./types";

type AssetConvention = {
  readonly directoryName: string;
  readonly kind: AssetKind;
  readonly payloadFile: string;
};

const ASSET_CONVENTIONS: readonly AssetConvention[] = [
  { directoryName: "agents", kind: "agent", payloadFile: "AGENT.md" },
  { directoryName: "commands", kind: "command", payloadFile: "COMMAND.md" },
  { directoryName: "hooks", kind: "hook", payloadFile: "HOOK.md" },
  { directoryName: "skills", kind: "skill", payloadFile: "SKILL.md" },
];

/** Discovers all packs under the repository's packs/ directory. */
export async function discoverPackRepository(rootPath: string): Promise<DiscoveryResult> {
  const diagnostics: Diagnostic[] = [];
  const packsPath = join(rootPath, "packs");
  const packNames = await safeDirectoryNames(packsPath);
  const packs: PackIndex[] = [];

  if (packNames.length === 0) {
    diagnostics.push({
      code: "missing-packs-directory",
      message: "No packs were discovered under packs/.",
      path: packsPath,
      severity: "error",
    });
  }

  for (const packName of packNames) {
    const pack = await discoverPack(packsPath, packName, diagnostics);

    if (pack) {
      packs.push(pack);
    }
  }

  return { diagnostics, index: { packs, rootPath } };
}

/** Discovers one pack directory and returns an index entry when PACK.md can be read. */
async function discoverPack(
  packsPath: string,
  packId: string,
  diagnostics: Diagnostic[],
): Promise<PackIndex | undefined> {
  const directoryPath = join(packsPath, packId);
  const packFilePath = join(directoryPath, "PACK.md");
  const packText = await safeReadFile(packFilePath);

  if (packText === undefined) {
    diagnostics.push({
      code: "missing-pack-file",
      message: "Pack directory is missing PACK.md.",
      path: packFilePath,
      severity: "error",
    });
    return undefined;
  }

  const document = parseMarkdownContract(packFilePath, packText, "pack");
  diagnostics.push(...document.diagnostics);

  const assets = await discoverPackAssets(packId, directoryPath, diagnostics);

  return {
    assets,
    description: document.keys.Description ?? "",
    directoryPath,
    id: packId,
    name: document.keys.Name ?? packId,
    packFilePath,
    sections: document.sections,
    version: document.keys.Version ?? "",
  };
}

/** Discovers all convention-supported asset directories inside one pack. */
async function discoverPackAssets(
  packId: string,
  packPath: string,
  diagnostics: Diagnostic[],
): Promise<AssetIndex[]> {
  const assets: AssetIndex[] = [];

  for (const convention of ASSET_CONVENTIONS) {
    const kindPath = join(packPath, convention.directoryName);
    const assetNames = await safeDirectoryNames(kindPath);

    for (const assetName of assetNames) {
      assets.push(await discoverAsset(packId, kindPath, assetName, convention, diagnostics));
    }
  }

  return assets;
}

/** Discovers one asset and parses its optional ASSET.md contract when present. */
async function discoverAsset(
  packId: string,
  kindPath: string,
  assetName: string,
  convention: AssetConvention,
  diagnostics: Diagnostic[],
): Promise<AssetIndex> {
  const directoryPath = join(kindPath, assetName);
  const contractPath = join(directoryPath, "ASSET.md");
  const contractText = await safeReadFile(contractPath);
  const parsedContract =
    contractText !== undefined
      ? parseMarkdownContract(contractPath, contractText, "asset")
      : undefined;
  const payloadRelativePaths = resolvePayloadRelativePaths(
    convention,
    parsedContract,
    contractPath,
    diagnostics,
  );
  const payloadPaths = payloadRelativePaths.map((payloadPath) => join(directoryPath, payloadPath));

  for (const payloadPath of payloadPaths) {
    if (!(await fileExists(payloadPath))) {
      diagnostics.push({
        code: "missing-payload",
        message: `Asset '${assetName}' is missing payload file ${payloadPath}.`,
        path: payloadPath,
        severity: "error",
      });
    }
  }

  if (parsedContract) {
    diagnostics.push(...parsedContract.diagnostics);
  }

  const contract = parsedContract
    ? { keys: parsedContract.keys, path: parsedContract.path, sections: parsedContract.sections }
    : undefined;

  return {
    ...(contract ? { contract } : {}),
    directoryPath,
    id: `${packId}/${convention.kind}/${assetName}`,
    kind: convention.kind,
    name: assetName,
    payloadPaths,
  };
}

/** Resolves convention payloads plus optional ASSET.md overrides into relative paths. */
function resolvePayloadRelativePaths(
  convention: AssetConvention,
  contract: { readonly keys: Record<string, string> } | undefined,
  contractPath: string,
  diagnostics: Diagnostic[],
): string[] {
  if (!contract) {
    return [convention.payloadFile];
  }

  const payload = contract.keys.Payload;
  const payloads = contract.keys.Payloads;
  const hasPayload = Object.hasOwn(contract.keys, "Payload");
  const hasPayloads = Object.hasOwn(contract.keys, "Payloads");

  if (hasPayload && hasPayloads) {
    diagnostics.push({
      code: "conflicting-payload-keys",
      message: "ASSET.md must not declare both Payload and Payloads.",
      path: contractPath,
      severity: "error",
    });
  }

  if (hasPayloads && payloads !== undefined) {
    return validatePayloadEntries(
      payloads.split(","),
      convention.payloadFile,
      contractPath,
      diagnostics,
    );
  }

  if (hasPayload && payload !== undefined) {
    return validatePayloadEntries([payload], convention.payloadFile, contractPath, diagnostics);
  }

  return [convention.payloadFile];
}

/** Validates payload override entries and falls back to the convention payload when empty. */
function validatePayloadEntries(
  entries: string[],
  fallbackPayload: string,
  contractPath: string,
  diagnostics: Diagnostic[],
): string[] {
  const normalizedEntries = entries.map((entry) => entry.trim()).filter((entry) => entry !== "");

  if (normalizedEntries.length === 0) {
    diagnostics.push({
      code: "missing-payload-declaration",
      message: "Payload or Payloads must declare at least one relative file path.",
      path: contractPath,
      severity: "error",
    });
    return [fallbackPayload];
  }

  const validEntries = normalizedEntries.filter((entry) =>
    isValidRelativePayload(entry, contractPath, diagnostics),
  );

  return validEntries.length > 0 ? validEntries : [fallbackPayload];
}

/** Checks that a payload override stays inside the asset directory. */
function isValidRelativePayload(
  entry: string,
  contractPath: string,
  diagnostics: Diagnostic[],
): boolean {
  if (isAbsolute(entry) || isWindowsAbsolutePath(entry) || entry.split(/[\\/]+/).includes("..")) {
    diagnostics.push({
      code: "invalid-payload-path",
      message: `Payload path '${entry}' must be relative to the asset directory.`,
      path: contractPath,
      severity: "error",
    });
    return false;
  }

  return true;
}

/** Checks Windows absolute payload paths even when packport runs on POSIX. */
function isWindowsAbsolutePath(entry: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(entry) || entry.startsWith("\\\\");
}

/** Returns sorted child directory names, treating a missing parent as empty. */
async function safeDirectoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw error;
  }
}

/** Reads a UTF-8 file, returning undefined when the file does not exist. */
async function safeReadFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }

    throw error;
  }
}

/** Checks whether a filesystem path exists and is a regular file. */
async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    return stats.isFile();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

/** Narrows Node filesystem errors that represent missing paths. */
function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
