// ABOUTME: Discovers portable packs from packport's convention-based source layout.
// ABOUTME: Builds a lightweight index while keeping payload files opaque.

import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { validateKnownPortableRefs } from "./harness-refs";
import { parseMarkdownContract } from "./markdown";
import { portableRefKey, scanPortableRefs } from "./refs";
import type {
  AssetIndex,
  AssetKind,
  Diagnostic,
  DiscoveryResult,
  MarkdownFieldValue,
  MarkdownSection,
  PackIndex,
  PortableRef,
} from "./types";

type AssetConvention = {
  readonly directoryName: string;
  readonly kind: AssetKind;
  readonly payloadFile: string;
};

const ASSET_CONVENTIONS: readonly AssetConvention[] = [
  { directoryName: "agents", kind: "agent", payloadFile: "AGENT.md" },
  { directoryName: "commands", kind: "command", payloadFile: "COMMAND.md" },
  { directoryName: "hooks", kind: "hook", payloadFile: "HOOK.md" },
  { directoryName: "instructions", kind: "instruction", payloadFile: "INSTRUCTION.md" },
  { directoryName: "skills", kind: "skill", payloadFile: "SKILL.md" },
];
const PACK_SUPPORT_FILES = [".mcp.json"];

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
  const declaredRefs = collectDeclaredRefs(packFilePath, document.sections, diagnostics);

  const assets = await discoverPackAssets(packId, directoryPath, declaredRefs, diagnostics);
  const supportPaths = await discoverPackSupportPaths(directoryPath, diagnostics);

  return {
    assets,
    declaredRefs,
    description: stringField(document.keys.description) ?? "",
    directoryPath,
    id: packId,
    name: stringField(document.keys.name) ?? packId,
    packFilePath,
    sections: document.sections,
    supportPaths,
    version: stringField(document.keys.version) ?? "",
  };
}

/** Discovers supported pack-level files that are copied into target packages. */
async function discoverPackSupportPaths(
  packPath: string,
  diagnostics: Diagnostic[],
): Promise<string[]> {
  const supportPaths: string[] = [];

  for (const fileName of PACK_SUPPORT_FILES) {
    const supportPath = join(packPath, fileName);

    try {
      const stats = await lstat(supportPath);

      if (stats.isFile()) {
        supportPaths.push(supportPath);
        continue;
      }

      diagnostics.push({
        code: "unsupported-pack-support",
        message: `Pack support file ${fileName} must be a regular file.`,
        path: supportPath,
        severity: "error",
      });
    } catch (error) {
      if (isMissingPathError(error)) {
        continue;
      }

      throw error;
    }
  }

  return supportPaths;
}

/** Discovers all convention-supported asset directories inside one pack. */
async function discoverPackAssets(
  packId: string,
  packPath: string,
  packDeclaredRefs: readonly PortableRef[],
  diagnostics: Diagnostic[],
): Promise<AssetIndex[]> {
  const assets: AssetIndex[] = [];

  for (const convention of ASSET_CONVENTIONS) {
    const kindPath = join(packPath, convention.directoryName);
    const assetNames = await safeDirectoryNames(kindPath);

    for (const assetName of assetNames) {
      assets.push(
        await discoverAsset(packId, kindPath, assetName, convention, packDeclaredRefs, diagnostics),
      );
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
  packDeclaredRefs: readonly PortableRef[],
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
  const declaredRefs =
    parsedContract === undefined
      ? []
      : collectDeclaredRefs(contractPath, parsedContract.sections, diagnostics);
  const payloadRefs: PortableRef[] = [];

  for (const payloadPath of payloadPaths) {
    if (!(await fileExists(payloadPath))) {
      diagnostics.push({
        code: "missing-payload",
        message: `Asset '${assetName}' is missing payload file ${payloadPath}.`,
        path: payloadPath,
        severity: "error",
      });
      continue;
    }

    payloadRefs.push(
      ...(await collectPayloadRefs(payloadPath, convention.kind === "command", diagnostics)),
    );
  }

  validateDeclaredPayloadRefs(payloadRefs, [...packDeclaredRefs, ...declaredRefs], diagnostics);

  if (parsedContract) {
    diagnostics.push(...parsedContract.diagnostics);
  }

  const contract = parsedContract
    ? { keys: parsedContract.keys, path: parsedContract.path, sections: parsedContract.sections }
    : undefined;

  return {
    ...(contract ? { contract } : {}),
    declaredRefs,
    directoryPath,
    id: `${packId}/${convention.kind}/${assetName}`,
    kind: convention.kind,
    name: assetName,
    payloadPaths,
    payloadRefs,
  };
}

/** Collects portable ref declarations from control-plane Markdown sections. */
function collectDeclaredRefs(
  path: string,
  sections: readonly MarkdownSection[],
  diagnostics: Diagnostic[],
): PortableRef[] {
  const refs: PortableRef[] = [];

  for (const section of sections) {
    const result = scanPortableRefs(path, section.body);
    diagnostics.push(...result.diagnostics);
    diagnostics.push(...validateKnownPortableRefs(result.refs));
    refs.push(...result.refs);
  }

  return refs;
}

/** Collects portable refs from a payload file without parsing any other payload semantics. */
async function collectPayloadRefs(
  path: string,
  ignoreTargetNativePlaceholders: boolean,
  diagnostics: Diagnostic[],
): Promise<PortableRef[]> {
  const text = await safeReadFile(path);

  if (text === undefined) {
    return [];
  }

  const result = scanPortableRefs(path, text, { ignoreTargetNativePlaceholders });
  diagnostics.push(...result.diagnostics);
  diagnostics.push(...validateKnownPortableRefs(result.refs));
  return [...result.refs];
}

/** Reports payload refs that are not declared at pack or asset scope. */
function validateDeclaredPayloadRefs(
  payloadRefs: readonly PortableRef[],
  declaredRefs: readonly PortableRef[],
  diagnostics: Diagnostic[],
): void {
  const declared = new Set(declaredRefs.map((ref) => portableRefKey(ref)));

  for (const ref of payloadRefs) {
    if (declared.has(portableRefKey(ref))) {
      continue;
    }

    diagnostics.push({
      code: "undeclared-portable-ref",
      message: `Portable ref '${ref.raw}' must be declared in PACK.md or ASSET.md.`,
      path: ref.path,
      severity: "error",
    });
  }
}

/** Resolves convention payloads plus optional ASSET.md overrides into relative paths. */
function resolvePayloadRelativePaths(
  convention: AssetConvention,
  contract: { readonly keys: Record<string, MarkdownFieldValue> } | undefined,
  contractPath: string,
  diagnostics: Diagnostic[],
): string[] {
  if (!contract) {
    return [convention.payloadFile];
  }

  const payload = contract.keys.payload;
  const payloads = contract.keys.payloads;
  const hasPayload = Object.hasOwn(contract.keys, "payload");
  const hasPayloads = Object.hasOwn(contract.keys, "payloads");

  if (hasPayload && hasPayloads) {
    diagnostics.push({
      code: "conflicting-payload-keys",
      message: "ASSET.md must not declare both payload and payloads.",
      path: contractPath,
      severity: "error",
    });
  }

  if (hasPayloads && payloads !== undefined) {
    return validatePayloadEntries(
      typeof payloads === "string" ? payloads.split(",") : [...payloads],
      convention.payloadFile,
      contractPath,
      diagnostics,
    );
  }

  if (hasPayload && typeof payload === "string") {
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
      message: "payload or payloads must declare at least one relative file path.",
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
      message: `payload path '${entry}' must be relative to the asset directory.`,
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

/** Returns a field only when the validated frontmatter value is scalar. */
function stringField(value: MarkdownFieldValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
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
