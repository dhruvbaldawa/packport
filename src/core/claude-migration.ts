// ABOUTME: Scans Claude Code marketplace and plugin source for migration candidates.
// ABOUTME: Produces read-only reports before portable pack source generation exists.

import { lstat, readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, extname, isAbsolute, join, relative } from "node:path";
import type { Diagnostic } from "./types";

export type ClaudeMigrationAssetKind = "agent" | "command" | "skill";

export type ClaudeMigrationClassification =
  | "harness-specific"
  | "personal-overlay"
  | "reusable-base"
  | "unclear"
  | "unsupported";

export type ClaudeMigrationAsset = {
  readonly classification: ClaudeMigrationClassification;
  readonly decisionRequired: boolean;
  readonly kind: ClaudeMigrationAssetKind;
  readonly name: string;
  readonly path: string;
  readonly pluginName: string;
  readonly reasons: readonly string[];
};

export type ClaudeMigrationPlugin = {
  readonly assets: readonly ClaudeMigrationAsset[];
  readonly description: string;
  readonly name: string;
  readonly path: string;
  readonly version: string;
};

export type ClaudeMigrationScanResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly plugins: readonly ClaudeMigrationPlugin[];
  readonly rootPath: string;
  readonly summary: {
    readonly assets: number;
    readonly plugins: number;
  };
};

type AssetConvention = {
  readonly directoryName: string;
  readonly kind: ClaudeMigrationAssetKind;
};

type ClaudeMarketplaceEntry = {
  readonly description: string;
  readonly name: string;
  readonly source: string;
};

type ClaudePluginManifest = {
  readonly description: string;
  readonly name: string;
  readonly version: string;
};

type JsonReadResult =
  | { readonly status: "invalid" }
  | { readonly status: "missing" }
  | { readonly status: "ok"; readonly value: unknown };

const ASSET_CONVENTIONS: readonly AssetConvention[] = [
  { directoryName: "agents", kind: "agent" },
  { directoryName: "commands", kind: "command" },
  { directoryName: "skills", kind: "skill" },
];

const MARKETPLACE_FILE = ".claude-plugin/marketplace.json";
const PLUGIN_FILE = ".claude-plugin/plugin.json";
const PERSONAL_SIGNALS = ["dhruv", "my ", "personal", "writing-like-me"];
const HARNESS_SIGNALS = ["claude code", "/plugin", ".claude"];

/** Scans a Claude marketplace root or a single Claude plugin directory. */
export async function scanClaudeMigrationSource(
  rootPath: string,
): Promise<ClaudeMigrationScanResult> {
  const diagnostics: Diagnostic[] = [];
  const marketplace = await readJsonFile(join(rootPath, MARKETPLACE_FILE), diagnostics);
  const plugins = await scanRoot(rootPath, marketplace, diagnostics);
  const assets = plugins.reduce((count, plugin) => count + plugin.assets.length, 0);

  if (marketplace.status === "missing" && plugins.length === 0 && diagnostics.length === 0) {
    diagnostics.push({
      code: "missing-claude-source",
      message: `Expected ${MARKETPLACE_FILE} or ${PLUGIN_FILE}.`,
      path: rootPath,
      severity: "error",
    });
  }

  return { diagnostics, plugins, rootPath, summary: { assets, plugins: plugins.length } };
}

/** Chooses marketplace or standalone plugin scanning based on source files present. */
async function scanRoot(
  rootPath: string,
  marketplace: JsonReadResult,
  diagnostics: Diagnostic[],
): Promise<ClaudeMigrationPlugin[]> {
  if (marketplace.status === "ok") {
    return await scanMarketplace(rootPath, marketplace.value, diagnostics);
  }

  if (marketplace.status === "invalid") {
    return [];
  }

  const pluginManifestPath = join(rootPath, PLUGIN_FILE);
  const pluginManifest = await readJsonFile(pluginManifestPath, diagnostics);

  if (pluginManifest.status === "ok") {
    const plugin = await scanClaudePluginWithManifest(
      rootPath,
      pluginManifestPath,
      pluginManifest.value,
      diagnostics,
    );

    return plugin ? [plugin] : [];
  }

  return [];
}

/** Formats a Claude migration scan as a deterministic text report. */
export function formatClaudeMigrationScan(result: ClaudeMigrationScanResult): string {
  const lines = [
    `Claude migration scan: ${result.rootPath}`,
    `Plugins: ${result.summary.plugins}`,
    `Assets: ${result.summary.assets}`,
  ];

  for (const plugin of result.plugins) {
    lines.push(`${plugin.name}@${plugin.version} ${plugin.path}`);

    for (const asset of plugin.assets) {
      lines.push(
        `${asset.kind} ${asset.pluginName}/${asset.name} ${asset.classification} ${asset.path}`,
      );
    }
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(
      `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`,
    );
  }

  return lines.join("\n");
}

/** Scans every plugin referenced by a Claude marketplace manifest. */
async function scanMarketplace(
  rootPath: string,
  value: unknown,
  diagnostics: Diagnostic[],
): Promise<ClaudeMigrationPlugin[]> {
  const entries = validateMarketplaceEntries(rootPath, value, diagnostics);
  const plugins: ClaudeMigrationPlugin[] = [];

  for (const entry of entries) {
    if (!(await isSafeMarketplaceSourcePath(rootPath, entry.source, diagnostics))) {
      continue;
    }

    const plugin = await scanClaudePlugin(join(rootPath, entry.source), diagnostics, entry);

    if (plugin) {
      plugins.push(plugin);
    }
  }

  return plugins;
}

/** Scans one Claude plugin directory when its manifest is valid. */
async function scanClaudePlugin(
  pluginPath: string,
  diagnostics: Diagnostic[],
  marketplaceEntry?: ClaudeMarketplaceEntry,
): Promise<ClaudeMigrationPlugin | undefined> {
  const manifestPath = join(pluginPath, PLUGIN_FILE);
  const manifestJson = await readJsonFile(manifestPath, diagnostics);

  if (manifestJson.status === "missing") {
    diagnostics.push({
      code: "missing-claude-plugin",
      message: `Claude plugin is missing ${PLUGIN_FILE}.`,
      path: manifestPath,
      severity: "error",
    });
    return undefined;
  }

  if (manifestJson.status === "invalid") {
    return undefined;
  }

  return await scanClaudePluginWithManifest(
    pluginPath,
    manifestPath,
    manifestJson.value,
    diagnostics,
    marketplaceEntry,
  );
}

/** Scans one Claude plugin directory from an already-read manifest. */
async function scanClaudePluginWithManifest(
  pluginPath: string,
  manifestPath: string,
  manifestValue: unknown,
  diagnostics: Diagnostic[],
  marketplaceEntry?: ClaudeMarketplaceEntry,
): Promise<ClaudeMigrationPlugin | undefined> {
  const manifest = validatePluginManifest(
    manifestPath,
    manifestValue,
    diagnostics,
    marketplaceEntry,
  );

  if (!manifest) {
    return undefined;
  }

  const assets = await scanClaudeAssets(pluginPath, manifest, diagnostics);

  return {
    assets,
    description: manifest.description,
    name: manifest.name,
    path: pluginPath,
    version: manifest.version,
  };
}

/** Scans convention-supported Claude asset directories in deterministic order. */
async function scanClaudeAssets(
  pluginPath: string,
  manifest: ClaudePluginManifest,
  diagnostics: Diagnostic[],
): Promise<ClaudeMigrationAsset[]> {
  const assets: ClaudeMigrationAsset[] = [];

  for (const convention of ASSET_CONVENTIONS) {
    if (convention.kind === "skill") {
      assets.push(...(await scanSkillAssets(pluginPath, manifest, diagnostics)));
      continue;
    }

    assets.push(...(await scanMarkdownAssets(pluginPath, manifest, convention, diagnostics)));
  }

  return assets;
}

/** Scans direct Markdown files in a Claude command or agent directory. */
async function scanMarkdownAssets(
  pluginPath: string,
  manifest: ClaudePluginManifest,
  convention: AssetConvention,
  diagnostics: Diagnostic[],
): Promise<ClaudeMigrationAsset[]> {
  const directoryPath = join(pluginPath, convention.directoryName);
  return await scanMarkdownAssetsInDirectory(
    pluginPath,
    manifest,
    convention,
    directoryPath,
    "",
    diagnostics,
  );
}

/** Recursively scans Markdown assets so namespaced Claude commands are not omitted. */
async function scanMarkdownAssetsInDirectory(
  pluginPath: string,
  manifest: ClaudePluginManifest,
  convention: AssetConvention,
  directoryPath: string,
  relativeDirectory: string,
  diagnostics: Diagnostic[],
): Promise<ClaudeMigrationAsset[]> {
  const entries = await safeSortedDirectoryEntries(directoryPath);
  const assets: ClaudeMigrationAsset[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      assets.push(
        ...(await scanMarkdownAssetsInDirectory(
          pluginPath,
          manifest,
          convention,
          join(directoryPath, entry.name),
          slashPath(join(relativeDirectory, entry.name)),
          diagnostics,
        )),
      );
      continue;
    }

    if (!entry.isFile() || extname(entry.name) !== ".md") {
      continue;
    }

    const path = join(directoryPath, entry.name);
    const text = await readTextFile(path, diagnostics);

    if (text === undefined) {
      continue;
    }

    assets.push(
      createAsset(
        manifest,
        convention.kind,
        slashPath(join(relativeDirectory, basename(entry.name, ".md"))),
        pluginPath,
        path,
        text,
      ),
    );
  }

  return assets;
}

/** Scans Claude skill directories that contain SKILL.md. */
async function scanSkillAssets(
  pluginPath: string,
  manifest: ClaudePluginManifest,
  diagnostics: Diagnostic[],
): Promise<ClaudeMigrationAsset[]> {
  const skillsPath = join(pluginPath, "skills");
  const entries = await safeSortedDirectoryEntries(skillsPath);
  const assets: ClaudeMigrationAsset[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const path = join(skillsPath, entry.name, "SKILL.md");
    const text = await readTextFile(path, diagnostics);

    if (text === undefined) {
      continue;
    }

    assets.push(createAsset(manifest, "skill", entry.name, pluginPath, path, text));
  }

  return assets;
}

/** Creates one asset record with transparent migration classification signals. */
function createAsset(
  manifest: ClaudePluginManifest,
  kind: ClaudeMigrationAssetKind,
  name: string,
  pluginPath: string,
  path: string,
  text: string,
): ClaudeMigrationAsset {
  const assetPath = relativePath(pluginPath, path);
  const classification = classifyAsset(manifest, name, assetPath, text);

  return {
    ...classification,
    kind,
    name,
    path: assetPath,
    pluginName: manifest.name,
  };
}

/** Classifies obvious migration candidates without hiding the reason from the driving skill. */
function classifyAsset(
  manifest: ClaudePluginManifest,
  name: string,
  path: string,
  text: string,
): Pick<ClaudeMigrationAsset, "classification" | "decisionRequired" | "reasons"> {
  const metadataText = `${manifest.name} ${manifest.description} ${name} ${path}`.toLowerCase();
  const bodyText = stripYamlFrontmatter(text).toLowerCase();

  if (PERSONAL_SIGNALS.some((signal) => metadataText.includes(signal))) {
    return {
      classification: "personal-overlay",
      decisionRequired: true,
      reasons: ["Path, name, or description contains a personal signal."],
    };
  }

  if (HARNESS_SIGNALS.some((signal) => bodyText.includes(signal))) {
    return {
      classification: "harness-specific",
      decisionRequired: true,
      reasons: ["Body references Claude-specific behavior."],
    };
  }

  return {
    classification: "unclear",
    decisionRequired: true,
    reasons: ["No personal or Claude-specific body signals found; user must confirm reuse."],
  };
}

/** Returns marketplace entries after validating source paths before use. */
function validateMarketplaceEntries(
  rootPath: string,
  value: unknown,
  diagnostics: Diagnostic[],
): ClaudeMarketplaceEntry[] {
  if (!isRecord(value) || !Array.isArray(value.plugins)) {
    diagnostics.push({
      code: "invalid-claude-marketplace",
      message: "Claude marketplace must contain a plugins list.",
      path: join(rootPath, MARKETPLACE_FILE),
      severity: "error",
    });
    return [];
  }

  return value.plugins.flatMap((entry) => validateMarketplaceEntry(rootPath, entry, diagnostics));
}

/** Validates one marketplace plugin entry. */
function validateMarketplaceEntry(
  rootPath: string,
  value: unknown,
  diagnostics: Diagnostic[],
): ClaudeMarketplaceEntry[] {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.source !== "string" ||
    !isSafeRelativePath(value.source)
  ) {
    diagnostics.push({
      code: "invalid-claude-plugin-source",
      message: "Claude marketplace plugin entries must declare safe relative source paths.",
      path: join(rootPath, MARKETPLACE_FILE),
      severity: "error",
    });
    return [];
  }

  return [
    {
      description: typeof value.description === "string" ? value.description : "",
      name: value.name,
      source: value.source,
    },
  ];
}

/** Validates one Claude plugin manifest. */
function validatePluginManifest(
  path: string,
  value: unknown,
  diagnostics: Diagnostic[],
  fallback?: ClaudeMarketplaceEntry,
): ClaudePluginManifest | undefined {
  if (!isRecord(value)) {
    diagnostics.push({
      code: "invalid-claude-plugin",
      message: "Claude plugin manifest must be a mapping.",
      path,
      severity: "error",
    });
    return undefined;
  }

  if (typeof value.name !== "string" || typeof value.version !== "string") {
    diagnostics.push({
      code: "invalid-claude-plugin",
      message: "Claude plugin manifest must declare name and version.",
      path,
      severity: "error",
    });
    return undefined;
  }

  return {
    description:
      typeof value.description === "string" ? value.description : (fallback?.description ?? ""),
    name: value.name,
    version: value.version,
  };
}

/** Reads and parses JSON while converting malformed input into diagnostics. */
async function readJsonFile(path: string, diagnostics: Diagnostic[]): Promise<JsonReadResult> {
  const text = await readTextFile(path, diagnostics);

  if (text === undefined) {
    return { status: "missing" };
  }

  try {
    return { status: "ok", value: JSON.parse(text) };
  } catch (error) {
    diagnostics.push({
      code: "invalid-claude-json",
      message: error instanceof Error ? error.message : "Could not parse Claude JSON file.",
      path,
      severity: "error",
    });
    return { status: "invalid" };
  }
}

/** Reads a regular UTF-8 file, returning undefined when it does not exist. */
async function readTextFile(path: string, diagnostics: Diagnostic[]): Promise<string | undefined> {
  try {
    const stats = await lstat(path);

    if (!stats.isFile()) {
      diagnostics.push({
        code: "unsupported-claude-source",
        message: "Claude source path must be a regular file.",
        path,
        severity: "error",
      });
      return undefined;
    }

    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }

    throw error;
  }
}

/** Returns sorted directory entries, treating a missing directory as empty. */
async function safeSortedDirectoryEntries(path: string): Promise<Dirent<string>[]> {
  try {
    const stats = await lstat(path);

    if (!stats.isDirectory()) {
      return [];
    }

    return (await readdir(path, { withFileTypes: true })).sort((left, right) =>
      compareStrings(left.name, right.name),
    );
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw error;
  }
}

/** Checks marketplace source path components so safe-looking paths cannot traverse symlinks. */
async function isSafeMarketplaceSourcePath(
  rootPath: string,
  source: string,
  diagnostics: Diagnostic[],
): Promise<boolean> {
  let currentPath = rootPath;

  for (const segment of source.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") {
      continue;
    }

    currentPath = join(currentPath, segment);

    try {
      const stats = await lstat(currentPath);

      if (stats.isSymbolicLink()) {
        diagnostics.push({
          code: "invalid-claude-plugin-source",
          message: "Claude marketplace plugin source paths must not contain symlinks.",
          path: join(rootPath, MARKETPLACE_FILE),
          severity: "error",
        });
        return false;
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return true;
      }

      throw error;
    }
  }

  return true;
}

/** Removes YAML frontmatter so target-native metadata does not dominate content signals. */
function stripYamlFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) {
    return text;
  }

  const end = text.indexOf("\n---\n", 4);
  return end === -1 ? text : text.slice(end + "\n---\n".length);
}

/** Checks that a manifest source path is relative and stays under the marketplace root. */
function isSafeRelativePath(value: string): boolean {
  return (
    value !== "" &&
    !value.includes("\0") &&
    !isAbsolute(value) &&
    !isWindowsAbsolutePath(value) &&
    !value.split(/[\\/]+/).includes("..")
  );
}

/** Checks Windows absolute paths even when packport runs on POSIX. */
function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/** Narrows unknown parsed JSON values to records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Compares strings without locale-sensitive ordering. */
function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

/** Converts an absolute source path into a portable slash-separated path. */
function relativePath(rootPath: string, path: string): string {
  return slashPath(relative(rootPath, path));
}

/** Converts filesystem separators into portable slash-separated paths. */
function slashPath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Narrows Node filesystem errors that represent missing paths. */
function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
