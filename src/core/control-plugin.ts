// ABOUTME: Generates harness-native packport control plugins from built-in skill source.
// ABOUTME: Keeps control skills separate from user pack payload generation.

import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { readPackLock, refreshPackLockGeneratedOutput, writePackLock } from "./lockfile";

export const CONTROL_PLUGIN_NAME = "packport";
export const CONTROL_PLUGIN_STATE_FILE = ".packport-control-plugin.json";
export const CONTROL_PACK_NAME = "packport-control";
export const CONTROL_PACK_DIRECTORY = join("packs", CONTROL_PACK_NAME);
export const CONTROL_SKILLS_DIRECTORY = "skills";
export const CLAUDE_CONTROL_MARKETPLACE_FILE = ".claude-plugin/marketplace.json";
export const CONFIGPORT_CONTROL_PLUGIN_NAME = "configport";
export const CONFIGPORT_CONTROL_PACK_NAME = "configport-control";
export const CONFIGPORT_CONTROL_PACK_DIRECTORY = join("packs", CONFIGPORT_CONTROL_PACK_NAME);

export type ControlPluginKind = "configport" | "packport";

export type ControlSkill = {
  readonly name: string;
  readonly sourcePath: string;
};

export type GenerateControlPluginResult = {
  readonly files: readonly string[];
  readonly pluginPath: string;
  readonly skills: readonly ControlSkill[];
};

export type ClaudeControlMarketplaceEntry = {
  readonly description: string;
  readonly name: string;
  readonly source: string;
};

export type GenerateClaudeControlMarketplaceResult = {
  readonly entries: readonly ClaudeControlMarketplaceEntry[];
  readonly files: readonly string[];
  readonly marketplacePath: string;
};

type ClaudePluginManifest = {
  readonly author: { readonly name: string };
  readonly description: string;
  readonly name: string;
  readonly version: string;
};

type GeneratedControlPluginState = {
  readonly files: readonly string[];
  readonly generatedBy: "packport";
  readonly stateVersion: 1;
};

type ClaudeControlMarketplace = {
  readonly name: string;
  readonly owner: { readonly name: string };
  readonly plugins: readonly ClaudeControlMarketplaceEntry[];
};

function controlPluginManifest(
  pluginKind: ControlPluginKind,
  version: string,
): ClaudePluginManifest {
  if (pluginKind === "configport") {
    return {
      author: { name: "packport" },
      description: "configport control skills for local agent-pack configuration",
      name: CONFIGPORT_CONTROL_PLUGIN_NAME,
      version,
    };
  }

  return {
    author: { name: "packport" },
    description: "packport control skills for portable agent packs",
    name: CONTROL_PLUGIN_NAME,
    version,
  };
}

/** Discovers built-in control skills from the selected control pack source tree. */
export async function discoverControlSkills(
  rootPath: string,
  pluginKind: ControlPluginKind = "packport",
): Promise<ControlSkill[]> {
  const skillsPath = controlSkillsPath(rootPath, pluginKind);
  const entries = await readdir(skillsPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      sourcePath: join(skillsPath, entry.name, "SKILL.md"),
    }))
    .sort((left, right) => compareStrings(left.name, right.name));
}

/** Generates a Claude Code control plugin containing built-in control skills. */
export async function generateClaudeControlPlugin(
  rootPath: string,
  outputPath: string,
  version: string,
  pluginKind: ControlPluginKind = "packport",
): Promise<GenerateControlPluginResult> {
  assertSafeOutputPath(rootPath, outputPath);

  const skills = await discoverControlSkills(rootPath, pluginKind);

  if (skills.length === 0) {
    throw new Error(
      `No ${pluginKind} control skills found under ${controlSkillsPath(rootPath, pluginKind)}.`,
    );
  }

  const files: string[] = [];
  const generatedFiles: string[] = [];
  await clearPreviouslyGeneratedFiles(outputPath);

  const manifestFile = ".claude-plugin/plugin.json";

  await writeGeneratedJsonFile(
    outputPath,
    manifestFile,
    controlPluginManifest(pluginKind, version),
  );
  files.push(join(outputPath, manifestFile));
  generatedFiles.push(manifestFile);

  for (const skill of skills) {
    const skillFile = `${CONTROL_SKILLS_DIRECTORY}/${skill.name}/SKILL.md`;
    await writeGeneratedTextFile(outputPath, skillFile, await readSourceSkillFile(skill));
    files.push(join(outputPath, skillFile));
    generatedFiles.push(skillFile);
  }

  await writeGeneratedJsonFile(outputPath, CONTROL_PLUGIN_STATE_FILE, {
    files: generatedFiles,
    generatedBy: "packport",
    stateVersion: 1,
  });
  files.push(join(outputPath, CONTROL_PLUGIN_STATE_FILE));

  return { files, pluginPath: outputPath, skills };
}

/** Generates repo-local Claude Code marketplace metadata for built-in control plugins. */
export async function generateClaudeControlMarketplace(
  rootPath: string,
  packageRootPath = join(rootPath, ".packs", "claude"),
): Promise<GenerateClaudeControlMarketplaceResult> {
  const marketplacePath = join(rootPath, CLAUDE_CONTROL_MARKETPLACE_FILE);
  const lockResult = await readPackLock(rootPath);

  if (lockResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error(
      lockResult.diagnostics
        .map((diagnostic) => `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`)
        .join("\n"),
    );
  }

  const generatedEntries = claudeControlMarketplaceEntries(rootPath, packageRootPath);
  const generatedEntriesByName = new Map(generatedEntries.map((entry) => [entry.name, entry]));
  const replacedNames = new Set<string>();
  const existing = await readClaudeControlMarketplace(marketplacePath);
  const preservedEntries = existing.plugins.map((entry) => {
    const replacement = generatedEntriesByName.get(entry.name);

    if (replacement) {
      replacedNames.add(entry.name);
      return replacement;
    }

    return entry;
  });
  const entries = [
    ...preservedEntries,
    ...generatedEntries.filter((entry) => !replacedNames.has(entry.name)),
  ];

  await validateClaudeControlMarketplaceEntries(rootPath, entries, marketplacePath);
  await writeGeneratedJsonFile(rootPath, CLAUDE_CONTROL_MARKETPLACE_FILE, {
    name: existing.name,
    owner: existing.owner,
    plugins: entries,
  });

  if (lockResult.lock) {
    await writePackLock(
      rootPath,
      await refreshPackLockGeneratedOutput(rootPath, lockResult.lock, {
        kind: "marketplace",
        path: marketplacePath,
        target: "claude",
      }),
    );
  }

  return {
    entries,
    files: [marketplacePath],
    marketplacePath,
  };
}

function claudeControlMarketplaceEntries(
  rootPath: string,
  packageRootPath: string,
): readonly ClaudeControlMarketplaceEntry[] {
  return [
    claudeControlMarketplaceEntry("packport", rootPath, packageRootPath),
    claudeControlMarketplaceEntry("configport", rootPath, packageRootPath),
  ];
}

function claudeControlMarketplaceEntry(
  pluginKind: ControlPluginKind,
  rootPath: string,
  packageRootPath: string,
): ClaudeControlMarketplaceEntry {
  const manifest = controlPluginManifest(pluginKind, "0.0.0");

  return {
    description: manifest.description,
    name: manifest.name,
    source: slashPath(relative(rootPath, join(packageRootPath, manifest.name))),
  };
}

/** Reads a source skill only after rejecting symlink traversal. */
async function readSourceSkillFile(skill: ControlSkill): Promise<string> {
  await assertPathDoesNotContainSymlinks(skill.sourcePath);
  return await readFile(skill.sourcePath, "utf8");
}

async function readClaudeControlMarketplace(path: string): Promise<ClaudeControlMarketplace> {
  try {
    await assertPathDoesNotContainSymlinks(path);
    const parsed = JSON.parse(await readFile(path, "utf8"));

    const marketplace = normalizeClaudeControlMarketplace(parsed);

    if (marketplace) {
      return marketplace;
    }

    throw new Error(`Claude control marketplace is invalid: ${path}`);
  } catch (error) {
    if (isMissingPathError(error)) {
      return { name: "packport-local", owner: { name: "packport" }, plugins: [] };
    }

    throw error;
  }
}

async function validateClaudeControlMarketplaceEntries(
  rootPath: string,
  entries: readonly ClaudeControlMarketplaceEntry[],
  marketplacePath: string,
): Promise<void> {
  const resolvedRootPath = resolve(rootPath);

  for (const entry of entries) {
    if (!isSafeGeneratedFilePath(entry.source)) {
      throw new Error(
        `Claude marketplace source path is invalid in ${marketplacePath}: ${entry.source}`,
      );
    }

    const resolvedSourcePath = resolve(rootPath, entry.source);
    const relativeSourcePath = relative(resolvedRootPath, resolvedSourcePath);

    if (isOutsideRelativePath(relativeSourcePath)) {
      throw new Error(
        `Claude marketplace source path must stay inside ${rootPath}: ${entry.source}`,
      );
    }

    await assertPathDoesNotContainSymlinks(resolvedSourcePath);
  }
}

/** Refuses output paths that overlap the selected source control pack tree. */
function assertSafeOutputPath(rootPath: string, outputPath: string): void {
  const sourceRootPath = resolve(rootPath);
  const sourceControlPackPaths = [
    resolve(controlPackPath(rootPath, "packport")),
    resolve(controlPackPath(rootPath, "configport")),
  ];
  const resolvedOutputPath = resolve(outputPath);

  if (resolvedOutputPath === sourceRootPath) {
    throw new Error("Control plugin output path must not be the packport source root.");
  }

  if (sourceControlPackPaths.some((sourcePath) => isSameOrInside(resolvedOutputPath, sourcePath))) {
    throw new Error("Control plugin output path must not be inside a source control pack.");
  }
}

/** Returns a control pack path under a repository root. */
function controlPackPath(rootPath: string, pluginKind: ControlPluginKind): string {
  return join(
    rootPath,
    pluginKind === "configport" ? CONFIGPORT_CONTROL_PACK_DIRECTORY : CONTROL_PACK_DIRECTORY,
  );
}

/** Returns the source skills directory inside the selected control pack. */
function controlSkillsPath(rootPath: string, pluginKind: ControlPluginKind): string {
  return join(controlPackPath(rootPath, pluginKind), CONTROL_SKILLS_DIRECTORY);
}

/** Removes files listed in packport's generated state before rewriting the plugin. */
async function clearPreviouslyGeneratedFiles(outputPath: string): Promise<void> {
  const generatedFiles = await readGeneratedState(outputPath);

  await Promise.all(
    generatedFiles.map((generatedFile) => removeGeneratedFile(outputPath, generatedFile)),
  );
}

/** Removes one generated file after rejecting symlink traversal. */
async function removeGeneratedFile(outputPath: string, generatedFile: string): Promise<void> {
  const path = join(outputPath, generatedFile);

  await assertPathDoesNotContainSymlinks(path);
  await rm(path, { force: true });
}

/** Writes stable pretty JSON after creating the parent directory safely. */
async function writeGeneratedJsonFile(
  outputPath: string,
  generatedFile: string,
  value: unknown,
): Promise<void> {
  await writeGeneratedTextFile(outputPath, generatedFile, `${JSON.stringify(value, null, 2)}\n`);
}

/** Writes a generated text file after rejecting symlink traversal in existing parents. */
async function writeGeneratedTextFile(
  outputPath: string,
  generatedFile: string,
  contents: string,
): Promise<void> {
  const path = join(outputPath, generatedFile);

  if (!isSafeGeneratedFilePath(generatedFile)) {
    throw new Error(`Generated file path is invalid: ${generatedFile}`);
  }

  await assertPathDoesNotContainSymlinks(path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

/** Reads and validates packport's generated-file ownership state. */
async function readGeneratedState(outputPath: string): Promise<string[]> {
  const statePath = join(outputPath, CONTROL_PLUGIN_STATE_FILE);

  try {
    await assertPathDoesNotContainSymlinks(statePath);
    const state = JSON.parse(await readFile(statePath, "utf8"));

    if (!isGeneratedControlPluginState(state)) {
      throw new Error(`Generated control plugin state is invalid: ${statePath}`);
    }

    return [...state.files];
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw error;
  }
}

/** Lstats existing path components so generated IO does not traverse symlinks. */
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
        throw new Error(`Generated path must not contain symlinks: ${currentPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }
  }
}

/** Checks that parsed generated-file state is safe to use for deletion. */
function isGeneratedControlPluginState(value: unknown): value is GeneratedControlPluginState {
  return (
    isRecord(value) &&
    value.generatedBy === "packport" &&
    value.stateVersion === 1 &&
    Array.isArray(value.files) &&
    value.files.every(isSafeGeneratedFilePath)
  );
}

function normalizeClaudeControlMarketplace(value: unknown): ClaudeControlMarketplace | undefined {
  if (!isRecord(value) || !Array.isArray(value.plugins)) {
    return undefined;
  }

  const plugins: ClaudeControlMarketplaceEntry[] = [];

  for (const entry of value.plugins) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.source !== "string") {
      return undefined;
    }

    plugins.push({
      description: typeof entry.description === "string" ? entry.description : "",
      name: entry.name,
      source: entry.source,
    });
  }

  return {
    name: typeof value.name === "string" ? value.name : "packport-local",
    owner:
      isRecord(value.owner) && typeof value.owner.name === "string"
        ? { name: value.owner.name }
        : { name: "packport" },
    plugins,
  };
}

/** Checks that a generated file path can only address files under the output directory. */
function isSafeGeneratedFilePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    !value.includes("\\") &&
    !isAbsolute(value) &&
    !value.split(/[\\/]+/).includes("..")
  );
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

function slashPath(path: string): string {
  return path.split(sep).join("/");
}

/** Checks whether a path is equal to or nested inside another path. */
function isSameOrInside(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}${sep}`);
}

function isOutsideRelativePath(value: string): boolean {
  return value === ".." || value.startsWith(`..${sep}`) || value.startsWith("../");
}

/** Narrows unknown parsed JSON values to records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrows Node filesystem errors that represent missing paths. */
function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
