// ABOUTME: Generates harness-native packport control plugins from built-in skill source.
// ABOUTME: Keeps control skills separate from user pack payload generation.

import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

export const CONTROL_PLUGIN_NAME = "packport";
export const CONTROL_PLUGIN_STATE_FILE = ".packport-control-plugin.json";
export const CONTROL_PACK_NAME = "packport-control";
export const CONTROL_PACK_DIRECTORY = join("packs", CONTROL_PACK_NAME);
export const CONTROL_SKILLS_DIRECTORY = "skills";
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

/** Reads a source skill only after rejecting symlink traversal. */
async function readSourceSkillFile(skill: ControlSkill): Promise<string> {
  await assertPathDoesNotContainSymlinks(skill.sourcePath);
  return await readFile(skill.sourcePath, "utf8");
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
  value: ClaudePluginManifest | GeneratedControlPluginState,
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

/** Checks whether a path is equal to or nested inside another path. */
function isSameOrInside(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}${sep}`);
}

/** Narrows unknown parsed JSON values to records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrows Node filesystem errors that represent missing paths. */
function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
