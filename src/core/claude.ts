// ABOUTME: Generates Claude Code plugin packages and marketplace metadata from portable packs.
// ABOUTME: Emits repo-local .packs/claude packages while configport owns instruction placement.

import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import {
  CONFIGPORT_CONTROL_PLUGIN_NAME,
  CONTROL_PLUGIN_NAME,
  isBuiltInControlPack,
  isBuiltInControlPluginPackage,
} from "./control-packs";
import { discoverPackRepository } from "./discovery";
import {
  readPackLock,
  writePackGenerationSelectionLock,
  type GeneratedOutput,
  type LockedOutput,
} from "./lockfile";
import { isAssetPayloadPath, renderAssetPayloadRefs } from "./payload-refs";
import type { AssetIndex, Diagnostic, PackIndex } from "./types";

export const CLAUDE_DEFAULT_OUTPUT_DIRECTORY = join(".packs", "claude");
export const CLAUDE_MARKETPLACE_FILE = join(".claude-plugin", "marketplace.json");
const PACKPORT_TOOL_VERSION = "0.0.0";

export type GenerateClaudeResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly files: readonly string[];
  readonly marketplacePath: string;
  readonly outputPath: string;
  readonly rootPath: string;
  readonly summary: {
    readonly agents: number;
    readonly commands: number;
    readonly files: number;
    readonly marketplaceEntries: number;
    readonly plugins: number;
    readonly skills: number;
  };
};

export type GenerateClaudeOptions = {
  readonly includeControlPacks?: boolean;
};

type ClaudePluginManifest = {
  readonly author: { readonly name: string };
  readonly description: string;
  readonly name: string;
  readonly version: string;
};

type ClaudeMarketplace = {
  readonly name: string;
  readonly owner: { readonly name: string };
  readonly plugins: readonly ClaudeMarketplaceEntry[];
};

type ClaudeMarketplaceEntry = {
  readonly description: string;
  readonly name: string;
  readonly source: string;
};

type ReadMarketplaceResult =
  | { readonly marketplace: ClaudeMarketplace; readonly status: "ok" }
  | { readonly diagnostic: Diagnostic; readonly status: "error" };

type WriteOperation =
  | { readonly content: string | Uint8Array; readonly kind: "write"; readonly targetPath: string }
  | { readonly kind: "copy"; readonly sourcePath: string; readonly targetPath: string };

type ClaudePluginPlan = {
  readonly agents: number;
  readonly commands: number;
  readonly entry?: ClaudeMarketplaceEntry;
  readonly plugins: number;
  readonly skills: number;
};

/** Generates one Claude Code plugin per pack plus repo-local Claude marketplace metadata. */
export async function generateClaudeOutput(
  rootPath: string,
  outputPath = join(rootPath, CLAUDE_DEFAULT_OUTPUT_DIRECTORY),
  options: GenerateClaudeOptions = {},
): Promise<GenerateClaudeResult> {
  const discovery = await discoverPackRepository(rootPath);
  const diagnostics: Diagnostic[] = [
    ...discovery.diagnostics,
    ...validateClaudeOutputRoot(rootPath, outputPath),
  ];
  const files: string[] = [];
  const marketplacePath = join(rootPath, CLAUDE_MARKETPLACE_FILE);
  const operations: WriteOperation[] = [];
  const generatedPaths: string[] = [];
  const entries: ClaudeMarketplaceEntry[] = [];
  let agents = 0;
  let commands = 0;
  let lockDecisions: readonly string[] = [];
  let marketplaceEntries = 0;
  let plugins = 0;
  let preservedOutputs: readonly LockedOutput[] = [];
  let skills = 0;

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    const lockResult = await readPackLock(rootPath);
    diagnostics.push(...lockResult.diagnostics);
    lockDecisions = lockResult.lock?.decisions ?? [];
    preservedOutputs = lockResult.lock?.outputs ?? [];
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    for (const pack of userGenerationPacks(discovery.index.packs, options.includeControlPacks)) {
      const plan = await planClaudePlugin(
        pack,
        rootPath,
        outputPath,
        operations,
        generatedPaths,
        diagnostics,
      );

      agents += plan.agents;
      commands += plan.commands;
      plugins += plan.plugins;
      skills += plan.skills;

      if (plan.entry) {
        entries.push(plan.entry);
      }
    }
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    await planClaudeMarketplace(
      rootPath,
      marketplacePath,
      entries,
      preservedOutputs,
      operations,
      generatedPaths,
      diagnostics,
    );
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    for (const operation of operations) {
      const diagnostic = await validateGeneratedPath(operation.targetPath);

      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
    }

    for (const staleOutput of staleClaudePackageOutputs(rootPath, preservedOutputs, operations)) {
      const diagnostic = await validateStaleOutputPath(rootPath, staleOutput);

      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    agents = 0;
    commands = 0;
    plugins = 0;
    skills = 0;
  } else {
    marketplaceEntries = entries.length;

    await removeStaleClaudePackageOutputs(rootPath, preservedOutputs, operations);

    for (const operation of operations) {
      await executeWriteOperation(operation, files);
    }

    await writePackGenerationSelectionLock(
      rootPath,
      discovery.index,
      PACKPORT_TOOL_VERSION,
      files.map((file) => claudeGeneratedOutput(file, outputPath, marketplacePath)),
      "claude",
      [CONTROL_PLUGIN_NAME, CONFIGPORT_CONTROL_PLUGIN_NAME],
      lockDecisions,
      preservedOutputs,
    );
  }

  return {
    diagnostics,
    files,
    marketplacePath,
    outputPath,
    rootPath,
    summary: {
      agents,
      commands,
      files: files.length,
      marketplaceEntries,
      plugins,
      skills,
    },
  };
}

function userGenerationPacks(
  packs: readonly PackIndex[],
  includeControlPacks = false,
): readonly PackIndex[] {
  return includeControlPacks ? packs : packs.filter((pack) => !isBuiltInControlPack(pack.id));
}

/** Formats Claude generation diagnostics for CLI and control-skill surfaces. */
export function formatClaudeDiagnostics(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "No Claude generation issues found.";
  }

  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`,
    )
    .join("\n");
}

function claudeGeneratedOutput(
  path: string,
  outputPath: string,
  marketplacePath: string,
): GeneratedOutput {
  if (path === marketplacePath) {
    return { kind: "marketplace", path, target: "claude" };
  }

  const [packageName] = relative(outputPath, path).split(sep);

  return {
    kind: "package",
    ...(packageName ? { packageName } : {}),
    path,
    target: "claude",
  };
}

async function planClaudePlugin(
  pack: PackIndex,
  rootPath: string,
  outputPath: string,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): Promise<ClaudePluginPlan> {
  const pluginPath = join(outputPath, pack.id);

  if (isBuiltInControlPluginPackage(pack.id)) {
    diagnostics.push({
      code: "reserved-claude-plugin-name",
      message: `Claude plugin name is reserved for packport control packages: ${pack.id}.`,
      path: pack.directoryPath,
      severity: "error",
    });
    return { agents: 0, commands: 0, plugins: 0, skills: 0 };
  }

  if (!isValidClaudeName(pack.id)) {
    diagnostics.push({
      code: "invalid-claude-plugin-name",
      message: `Claude plugin names must be lowercase alphanumeric with single hyphen separators: ${pack.id}.`,
      path: pack.directoryPath,
      severity: "error",
    });
    return { agents: 0, commands: 0, plugins: 0, skills: 0 };
  }

  let agents = 0;
  let commands = 0;
  let skills = 0;

  for (const asset of pack.assets) {
    if (asset.kind === "command") {
      if (
        await planMarkdownAsset(
          asset,
          pluginPath,
          "commands",
          diagnostics,
          operations,
          generatedPaths,
        )
      ) {
        commands += 1;
      }
      continue;
    }

    if (asset.kind === "agent") {
      if (
        await planMarkdownAsset(
          asset,
          pluginPath,
          "agents",
          diagnostics,
          operations,
          generatedPaths,
        )
      ) {
        agents += 1;
      }
      continue;
    }

    if (asset.kind === "skill") {
      if (await planSkillAsset(asset, pluginPath, operations, generatedPaths, diagnostics)) {
        skills += 1;
      }
      continue;
    }

    diagnostics.push({
      code: "unsupported-claude-asset",
      message: `Claude generation does not support ${asset.kind} assets yet.`,
      path: asset.directoryPath,
      severity: "warning",
    });
  }

  addWriteOperation(
    join(pluginPath, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(claudePluginManifest(pack), null, 2)}\n`,
    operations,
    generatedPaths,
    diagnostics,
  );

  return {
    agents,
    commands,
    entry: claudeMarketplaceEntry(pack, rootPath, pluginPath),
    plugins: 1,
    skills,
  };
}

async function planMarkdownAsset(
  asset: AssetIndex,
  pluginPath: string,
  directoryName: "agents" | "commands",
  diagnostics: Diagnostic[],
  operations: WriteOperation[],
  generatedPaths: string[],
): Promise<boolean> {
  if (!validateClaudeAssetName(asset, diagnostics)) {
    return false;
  }

  const payloadPath = firstPayloadPath(asset);
  const markdown = await readSourceTextFile(payloadPath, diagnostics);

  if (markdown === undefined) {
    return false;
  }
  const rendered = renderAssetPayloadRefs(asset, payloadPath, markdown, "claude", diagnostics);

  if (rendered === undefined) {
    return false;
  }

  return addWriteOperation(
    join(pluginPath, directoryName, `${asset.name}.md`),
    ensureTrailingNewline(rendered),
    operations,
    generatedPaths,
    diagnostics,
  );
}

async function planSkillAsset(
  asset: AssetIndex,
  pluginPath: string,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): Promise<boolean> {
  if (!validateClaudeAssetName(asset, diagnostics)) {
    return false;
  }

  const targetPath = join(pluginPath, "skills", asset.name);
  const primaryPayloadPath = firstPayloadPath(asset);
  const markdown = await readSourceTextFile(primaryPayloadPath, diagnostics);
  let copiedFiles = 0;

  if (markdown === undefined) {
    return false;
  }

  const rendered = renderAssetPayloadRefs(
    asset,
    primaryPayloadPath,
    markdown,
    "claude",
    diagnostics,
  );

  if (rendered === undefined) {
    return false;
  }

  if (!reserveGeneratedPath(targetPath, generatedPaths, diagnostics)) {
    return false;
  }

  if (
    addWriteOperation(
      join(targetPath, "SKILL.md"),
      ensureTrailingNewline(rendered),
      operations,
      generatedPaths,
      diagnostics,
    )
  ) {
    copiedFiles += 1;
  }

  copiedFiles += await copySkillDirectory(
    asset,
    asset.directoryPath,
    targetPath,
    new Set([
      resolve(primaryPayloadPath),
      resolve(join(asset.directoryPath, "SKILL.md")),
      resolve(join(asset.directoryPath, "ASSET.md")),
    ]),
    operations,
    generatedPaths,
    diagnostics,
    true,
  );

  return copiedFiles > 0;
}

async function copySkillDirectory(
  asset: AssetIndex,
  sourcePath: string,
  targetPath: string,
  skippedSourcePaths: Set<string>,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
  isRoot: boolean,
): Promise<number> {
  let copiedFiles = 0;
  const entries = (await readdir(sourcePath, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  for (const entry of entries) {
    if (isRoot && entry.name === "ASSET.md") {
      continue;
    }

    const sourceEntryPath = join(sourcePath, entry.name);
    const targetEntryPath = join(targetPath, entry.name);

    if (skippedSourcePaths.has(resolve(sourceEntryPath))) {
      continue;
    }

    if (entry.isDirectory()) {
      copiedFiles += await copySkillDirectory(
        asset,
        sourceEntryPath,
        targetEntryPath,
        skippedSourcePaths,
        operations,
        generatedPaths,
        diagnostics,
        false,
      );
      continue;
    }

    if (!entry.isFile()) {
      diagnostics.push({
        code: "unsupported-claude-skill-entry",
        message: "Claude generation only copies regular skill support files and directories.",
        path: sourceEntryPath,
        severity: "warning",
      });
      continue;
    }

    if (isAssetPayloadPath(asset, sourceEntryPath)) {
      const markdown = await readSourceTextFile(sourceEntryPath, diagnostics);
      const rendered =
        markdown === undefined
          ? undefined
          : renderAssetPayloadRefs(asset, sourceEntryPath, markdown, "claude", diagnostics);

      if (
        rendered !== undefined &&
        addWriteOperation(
          targetEntryPath,
          ensureTrailingNewline(rendered),
          operations,
          generatedPaths,
          diagnostics,
        )
      ) {
        copiedFiles += 1;
      }
      continue;
    }

    if (
      addCopyOperation(targetEntryPath, sourceEntryPath, operations, generatedPaths, diagnostics)
    ) {
      copiedFiles += 1;
    }
  }

  return copiedFiles;
}

async function planClaudeMarketplace(
  rootPath: string,
  marketplacePath: string,
  entries: readonly ClaudeMarketplaceEntry[],
  previousOutputs: readonly LockedOutput[],
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const existing = await readClaudeMarketplace(marketplacePath);

  if (existing.status === "error") {
    diagnostics.push(existing.diagnostic);
    return;
  }

  const generatedEntriesByName = new Map(entries.map((entry) => [entry.name, entry]));
  const previousGeneratedPackageNames = new Set(
    previousOutputs
      .filter(
        (output) =>
          output.target === "claude" &&
          output.kind === "package" &&
          output.packageName !== undefined &&
          !isBuiltInControlPluginPackage(output.packageName),
      )
      .map((output) => output.packageName as string),
  );
  const replacedNames = new Set<string>();
  const preservedEntries: ClaudeMarketplaceEntry[] = [];

  for (const entry of existing.marketplace.plugins) {
    const replacement = generatedEntriesByName.get(entry.name);

    if (replacement) {
      replacedNames.add(entry.name);
      preservedEntries.push(replacement);
      continue;
    }

    if (previousGeneratedPackageNames.has(entry.name)) {
      continue;
    }

    preservedEntries.push(entry);
  }

  const marketplace: ClaudeMarketplace = {
    name: existing.marketplace.name,
    owner: existing.marketplace.owner,
    plugins: [...preservedEntries, ...entries.filter((entry) => !replacedNames.has(entry.name))],
  };
  const diagnostic = await validateClaudeMarketplaceEntries(rootPath, marketplace.plugins);

  if (diagnostic) {
    diagnostics.push(diagnostic);
    return;
  }

  addWriteOperation(
    marketplacePath,
    `${JSON.stringify(marketplace, null, 2)}\n`,
    operations,
    generatedPaths,
    diagnostics,
  );
}

async function removeStaleClaudePackageOutputs(
  rootPath: string,
  previousOutputs: readonly LockedOutput[],
  operations: readonly WriteOperation[],
): Promise<void> {
  for (const staleOutput of staleClaudePackageOutputs(rootPath, previousOutputs, operations)) {
    const path = join(rootPath, staleOutput.path);

    await assertPathDoesNotContainSymlinks(path);
    await rm(path, { force: true });
  }
}

function staleClaudePackageOutputs(
  rootPath: string,
  previousOutputs: readonly LockedOutput[],
  operations: readonly WriteOperation[],
): readonly LockedOutput[] {
  const currentOutputPaths = new Set(
    operations.map((operation) => slashPath(relative(rootPath, operation.targetPath))),
  );

  return previousOutputs.filter(
    (output) =>
      output.target === "claude" &&
      output.kind === "package" &&
      (output.packageName === undefined || !isBuiltInControlPluginPackage(output.packageName)) &&
      !currentOutputPaths.has(output.path),
  );
}

async function validateStaleOutputPath(
  rootPath: string,
  output: LockedOutput,
): Promise<Diagnostic | undefined> {
  if (!isSafeGeneratedFilePath(output.path)) {
    return {
      code: "invalid-stale-claude-output",
      message: `Stale Claude output path must be a safe relative path: ${output.path}.`,
      path: join(rootPath, output.path),
      severity: "error",
    };
  }

  const resolvedRootPath = resolve(rootPath);
  const resolvedPath = resolve(rootPath, output.path);

  if (isOutsideRelativePath(relative(resolvedRootPath, resolvedPath))) {
    return {
      code: "invalid-stale-claude-output",
      message: `Stale Claude output path must stay inside the pack repository: ${output.path}.`,
      path: resolvedPath,
      severity: "error",
    };
  }

  const relativeToClaudeOutput = relative(
    resolve(rootPath, CLAUDE_DEFAULT_OUTPUT_DIRECTORY),
    resolvedPath,
  );

  if (relativeToClaudeOutput === "" || isOutsideRelativePath(relativeToClaudeOutput)) {
    return {
      code: "invalid-stale-claude-output",
      message: `Stale Claude output path must stay under ${CLAUDE_DEFAULT_OUTPUT_DIRECTORY}: ${output.path}.`,
      path: resolvedPath,
      severity: "error",
    };
  }

  try {
    await assertPathDoesNotContainSymlinks(resolvedPath);
    const stats = await lstat(resolvedPath);

    if (!stats.isFile()) {
      return {
        code: "invalid-stale-claude-output",
        message: `Stale Claude output path must be a regular file: ${output.path}.`,
        path: resolvedPath,
        severity: "error",
      };
    }

    return undefined;
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }

    return {
      code: isSymlinkPathError(error) ? "unsafe-claude-path" : "invalid-stale-claude-output",
      message:
        error instanceof Error ? error.message : "Stale Claude output could not be validated.",
      path: resolvedPath,
      severity: "error",
    };
  }
}

async function readClaudeMarketplace(path: string): Promise<ReadMarketplaceResult> {
  try {
    await assertPathDoesNotContainSymlinks(path);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    const marketplace = normalizeClaudeMarketplace(parsed);

    if (marketplace) {
      return { marketplace, status: "ok" };
    }

    return {
      diagnostic: {
        code: "invalid-claude-marketplace",
        message:
          "Existing Claude marketplace must contain a valid JSON object with a plugins array.",
        path,
        severity: "error",
      },
      status: "error",
    };
  } catch (error) {
    if (isMissingPathError(error)) {
      return {
        marketplace: { name: "packport-local", owner: { name: "packport" }, plugins: [] },
        status: "ok",
      };
    }

    return {
      diagnostic: {
        code: isSymlinkPathError(error) ? "unsafe-claude-path" : "invalid-claude-marketplace",
        message:
          error instanceof Error ? error.message : "Existing Claude marketplace could not be read.",
        path,
        severity: "error",
      },
      status: "error",
    };
  }
}

function normalizeClaudeMarketplace(value: unknown): ClaudeMarketplace | undefined {
  if (!isRecord(value) || !Array.isArray(value.plugins)) {
    return undefined;
  }

  const plugins: ClaudeMarketplaceEntry[] = [];

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

async function validateClaudeMarketplaceEntries(
  rootPath: string,
  entries: readonly ClaudeMarketplaceEntry[],
): Promise<Diagnostic | undefined> {
  const resolvedRootPath = resolve(rootPath);

  for (const entry of entries) {
    if (!isSafeGeneratedFilePath(entry.source)) {
      return {
        code: "invalid-claude-marketplace-source",
        message: `Claude marketplace local source path must be a safe relative path: ${entry.source}.`,
        path: rootPath,
        severity: "error",
      };
    }

    const resolvedSourcePath = resolve(rootPath, entry.source);
    const relativeSourcePath = relative(resolvedRootPath, resolvedSourcePath);

    if (isOutsideRelativePath(relativeSourcePath)) {
      return {
        code: "invalid-claude-marketplace-source",
        message: `Claude marketplace local source path must stay inside the pack repository: ${entry.source}.`,
        path: rootPath,
        severity: "error",
      };
    }

    try {
      await assertPathDoesNotContainSymlinks(resolvedSourcePath);
    } catch (error) {
      return {
        code: isSymlinkPathError(error)
          ? "unsafe-claude-path"
          : "invalid-claude-marketplace-source",
        message:
          error instanceof Error
            ? error.message
            : "Claude marketplace local source path could not be validated.",
        path: resolvedSourcePath,
        severity: "error",
      };
    }
  }

  return undefined;
}

function claudePluginManifest(pack: PackIndex): ClaudePluginManifest {
  return {
    author: { name: "packport" },
    description: pack.description || `${pack.name || pack.id} portable agent pack.`,
    name: pack.id,
    version: pack.version || "0.0.0",
  };
}

function claudeMarketplaceEntry(
  pack: PackIndex,
  rootPath: string,
  pluginPath: string,
): ClaudeMarketplaceEntry {
  return {
    description: pack.description || `${pack.name || pack.id} portable agent pack.`,
    name: pack.id,
    source: slashPath(relative(rootPath, pluginPath)),
  };
}

function validateClaudeOutputRoot(rootPath: string, outputPath: string): Diagnostic[] {
  const expectedPath = resolve(rootPath, CLAUDE_DEFAULT_OUTPUT_DIRECTORY);

  if (resolve(outputPath) === expectedPath) {
    return [];
  }

  return [
    {
      code: "invalid-claude-output-root",
      message: `Claude output must be written to ${CLAUDE_DEFAULT_OUTPUT_DIRECTORY} under the pack repository.`,
      path: outputPath,
      severity: "error",
    },
  ];
}

function validateClaudeAssetName(asset: AssetIndex, diagnostics: Diagnostic[]): boolean {
  if (isValidClaudeName(asset.name)) {
    return true;
  }

  diagnostics.push({
    code: "invalid-claude-asset-name",
    message: `Claude asset names must be lowercase alphanumeric with single hyphen separators: ${asset.name}.`,
    path: asset.directoryPath,
    severity: "error",
  });
  return false;
}

function isValidClaudeName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64;
}

function firstPayloadPath(asset: AssetIndex): string {
  const [payloadPath] = asset.payloadPaths;

  if (payloadPath === undefined) {
    throw new Error(`Asset has no payload paths: ${asset.id}`);
  }

  return payloadPath;
}

async function readSourceTextFile(
  path: string,
  diagnostics: Diagnostic[],
): Promise<string | undefined> {
  try {
    await assertPathDoesNotContainSymlinks(path);
    return await readFile(path, "utf8");
  } catch (error) {
    diagnostics.push({
      code: isSymlinkPathError(error) ? "unsafe-claude-source-path" : "unreadable-claude-source",
      message: error instanceof Error ? error.message : "Claude source payload could not be read.",
      path,
      severity: "error",
    });
    return undefined;
  }
}

function addWriteOperation(
  targetPath: string,
  content: string | Uint8Array,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): boolean {
  if (!reserveGeneratedPath(targetPath, generatedPaths, diagnostics)) {
    return false;
  }

  operations.push({ content, kind: "write", targetPath });
  return true;
}

function addCopyOperation(
  targetPath: string,
  sourcePath: string,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): boolean {
  if (!reserveGeneratedPath(targetPath, generatedPaths, diagnostics)) {
    return false;
  }

  operations.push({ kind: "copy", sourcePath, targetPath });
  return true;
}

function reserveGeneratedPath(
  targetPath: string,
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): boolean {
  const resolvedPath = resolve(targetPath);

  if (generatedPaths.includes(resolvedPath)) {
    diagnostics.push({
      code: "claude-target-collision",
      message: "Multiple pack assets map to the same Claude target path.",
      path: targetPath,
      severity: "error",
    });
    return false;
  }

  generatedPaths.push(resolvedPath);
  return true;
}

async function executeWriteOperation(operation: WriteOperation, files: string[]): Promise<void> {
  await assertWritableFilePath(operation.targetPath);
  await mkdir(dirname(operation.targetPath), { recursive: true });
  await assertWritableFilePath(operation.targetPath);

  if (operation.kind === "copy") {
    await assertPathDoesNotContainSymlinks(operation.sourcePath);
    await writeFile(operation.targetPath, await readFile(operation.sourcePath));
  } else {
    await writeFile(operation.targetPath, operation.content);
  }

  files.push(operation.targetPath);
}

async function validateGeneratedPath(path: string): Promise<Diagnostic | undefined> {
  try {
    await assertWritableFilePath(path);
    return undefined;
  } catch (error) {
    return {
      code: isSymlinkPathError(error) ? "unsafe-claude-path" : "unwritable-claude-path",
      message:
        error instanceof Error ? error.message : "Generated Claude path could not be validated.",
      path,
      severity: "error",
    };
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
        throw new Error(`Claude path must not contain symlinks: ${currentPath}`);
      }

      const isLast = index === segments.length - 1;

      if (!isLast && !stats.isDirectory()) {
        throw new Error(`Claude output parent path must be a directory: ${currentPath}`);
      }

      if (isLast && stats.isDirectory()) {
        throw new Error(`Claude output file path is an existing directory: ${currentPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }
  }
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
        throw new Error(`Claude path must not contain symlinks: ${currentPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }
  }
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function isSafeGeneratedFilePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    !value.includes("\\") &&
    !isAbsolute(value) &&
    !value.split(/[\\/]+/).includes("..")
  );
}

function isOutsideRelativePath(value: string): boolean {
  return value === ".." || value.startsWith(`..${sep}`) || value.startsWith("../");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isSymlinkPathError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith("Claude path must not contain symlinks:")
  );
}

function slashPath(path: string): string {
  return path.split(sep).join("/");
}
