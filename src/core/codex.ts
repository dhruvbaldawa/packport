// ABOUTME: Generates Codex plugin packages and marketplace metadata from portable packs.
// ABOUTME: Emits local .packs/codex packages while keeping profile overlays out of output.

import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { isBuiltInControlPack } from "./control-packs";
import { discoverPackRepository } from "./discovery";
import {
  readPackLock,
  writePackGenerationLock,
  type GeneratedOutput,
  type LockedOutput,
} from "./lockfile";
import { isAssetPayloadPath, renderAssetPayloadRefs } from "./payload-refs";
import type { AssetIndex, Diagnostic, PackIndex } from "./types";

export const CODEX_DEFAULT_OUTPUT_DIRECTORY = join(".packs", "codex");
export const CODEX_MARKETPLACE_FILE = join(".agents", "plugins", "marketplace.json");
const PACKPORT_TOOL_VERSION = "0.0.0";

export type GenerateCodexResult = {
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

export type GenerateCodexOptions = {
  readonly includeControlPacks?: boolean;
};

type ParsedFrontmatter = {
  readonly body: string;
  readonly frontmatter: Record<string, string>;
};

type CodexPluginManifest = {
  readonly author: { readonly name: string };
  readonly description: string;
  readonly interface: {
    readonly category: string;
    readonly developerName: string;
    readonly displayName: string;
    readonly longDescription: string;
    readonly shortDescription: string;
  };
  readonly license: string;
  readonly name: string;
  readonly skills?: string;
  readonly version: string;
};

type CodexMarketplace = {
  readonly interface: { readonly displayName: string };
  readonly name: string;
  readonly plugins: readonly CodexMarketplaceEntry[];
};

type CodexMarketplaceEntry = {
  readonly category?: string;
  readonly name: string;
  readonly policy: {
    readonly authentication: "ON_INSTALL" | "ON_USE";
    readonly installation: "AVAILABLE" | "INSTALLED_BY_DEFAULT" | "NOT_AVAILABLE";
  };
  readonly source: {
    readonly path: string;
    readonly source: "local";
  };
};

type ReadMarketplaceResult =
  | { readonly marketplace: CodexMarketplace; readonly status: "ok" }
  | { readonly diagnostic: Diagnostic; readonly status: "error" };

type WriteOperation =
  | { readonly content: string | Uint8Array; readonly kind: "write"; readonly targetPath: string }
  | { readonly kind: "copy"; readonly sourcePath: string; readonly targetPath: string };

type CodexPluginPlan = {
  readonly agents: number;
  readonly commands: number;
  readonly entry?: CodexMarketplaceEntry;
  readonly plugins: number;
  readonly skills: number;
};

/** Generates one Codex plugin per pack plus repo-local Codex marketplace metadata. */
export async function generateCodexOutput(
  rootPath: string,
  outputPath = join(rootPath, CODEX_DEFAULT_OUTPUT_DIRECTORY),
  options: GenerateCodexOptions = {},
): Promise<GenerateCodexResult> {
  const discovery = await discoverPackRepository(rootPath);
  const diagnostics: Diagnostic[] = [
    ...discovery.diagnostics,
    ...validateCodexOutputRoot(rootPath, outputPath),
  ];
  const files: string[] = [];
  const marketplacePath = join(rootPath, CODEX_MARKETPLACE_FILE);
  const operations: WriteOperation[] = [];
  const generatedPaths: string[] = [];
  const entries: CodexMarketplaceEntry[] = [];
  let agents = 0;
  let commands = 0;
  let lockDecisions: readonly string[] = [];
  let preservedOutputs: readonly LockedOutput[] = [];
  let marketplaceEntries = 0;
  let plugins = 0;
  let skills = 0;

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    const lockResult = await readPackLock(rootPath);
    diagnostics.push(...lockResult.diagnostics);
    lockDecisions = lockResult.lock?.decisions ?? [];
    preservedOutputs = lockResult.lock?.outputs ?? [];
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    for (const pack of userGenerationPacks(discovery.index.packs, options.includeControlPacks)) {
      const plan = await planCodexPlugin(
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
    await planCodexMarketplace(
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
      const diagnostic = await validateGeneratedFilePath(operation.targetPath);

      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
    }

    for (const staleOutput of staleCodexPackageOutputs(rootPath, preservedOutputs, operations)) {
      const diagnostic = await validateStaleCodexOutputPath(rootPath, staleOutput);

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

    await removeStaleCodexPackageOutputs(rootPath, preservedOutputs, operations);

    for (const operation of operations) {
      await executeWriteOperation(operation, files);
    }

    await writePackGenerationLock(
      rootPath,
      discovery.index,
      PACKPORT_TOOL_VERSION,
      files.map((file) => codexGeneratedOutput(file, outputPath, marketplacePath)),
      "codex",
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

/** Converts a generated Codex file path into a structured lockfile output entry. */
function codexGeneratedOutput(
  path: string,
  outputPath: string,
  marketplacePath: string,
): GeneratedOutput {
  if (path === marketplacePath) {
    return { kind: "marketplace", path, target: "codex" };
  }

  const [packageName] = relative(outputPath, path).split(sep);

  return {
    kind: "package",
    ...(packageName ? { packageName } : {}),
    path,
    target: "codex",
  };
}

/** Formats Codex generation diagnostics for CLI and control-skill surfaces. */
export function formatCodexDiagnostics(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "No Codex generation issues found.";
  }

  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`,
    )
    .join("\n");
}

async function planCodexPlugin(
  pack: PackIndex,
  rootPath: string,
  outputPath: string,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): Promise<CodexPluginPlan> {
  const pluginPath = join(outputPath, pack.id);

  if (!isValidCodexName(pack.id)) {
    diagnostics.push({
      code: "invalid-codex-plugin-name",
      message: `Codex plugin names must be lowercase alphanumeric with single hyphen separators: ${pack.id}.`,
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
        await planCommandSkillAsset(
          asset,
          pack,
          pluginPath,
          operations,
          generatedPaths,
          diagnostics,
        )
      ) {
        commands += 1;
        skills += 1;
      }
      continue;
    }

    if (asset.kind === "skill") {
      if (await planSkillAsset(asset, pluginPath, operations, generatedPaths, diagnostics)) {
        skills += 1;
      }
      continue;
    }

    if (asset.kind === "agent") {
      if (await planAgentAsset(asset, pluginPath, operations, generatedPaths, diagnostics)) {
        agents += 1;
      }
      continue;
    }

    diagnostics.push({
      code: "unsupported-codex-asset",
      message: `Codex generation does not support ${asset.kind} assets yet.`,
      path: asset.directoryPath,
      severity: "warning",
    });
  }

  addWriteOperation(
    join(pluginPath, ".codex-plugin", "plugin.json"),
    `${JSON.stringify(codexPluginManifest(pack, skills > 0), null, 2)}\n`,
    operations,
    generatedPaths,
    diagnostics,
  );

  return {
    agents,
    commands,
    entry: codexMarketplaceEntry(pack, rootPath, pluginPath),
    plugins: 1,
    skills,
  };
}

async function planCommandSkillAsset(
  asset: AssetIndex,
  pack: PackIndex,
  pluginPath: string,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): Promise<boolean> {
  if (!validateCodexAssetName(asset, "skill", diagnostics)) {
    return false;
  }

  const payloadPath = firstPayloadPath(asset);
  const markdown = await readSourceTextFile(payloadPath, diagnostics);

  if (markdown === undefined) {
    return false;
  }
  const rendered = renderAssetPayloadRefs(asset, payloadPath, markdown, "codex", diagnostics);

  if (rendered === undefined) {
    return false;
  }

  const targetPath = join(pluginPath, "skills", asset.name);
  const adapted = adaptCodexCommandSkillMarkdown(
    rendered,
    asset.name,
    `${asset.name} command from ${pack.name || pack.id}`,
    payloadPath,
    diagnostics,
  );

  if (adapted === undefined) {
    return false;
  }

  let copiedFiles = 0;

  if (
    addWriteOperation(
      join(targetPath, "SKILL.md"),
      adapted,
      operations,
      generatedPaths,
      diagnostics,
    )
  ) {
    copiedFiles += 1;
  }

  copiedFiles += await copyAssetSupportFiles(
    asset,
    targetPath,
    new Set([resolve(payloadPath), resolve(join(asset.directoryPath, "COMMAND.md"))]),
    operations,
    generatedPaths,
    diagnostics,
    true,
  );

  return copiedFiles > 0;
}

async function planSkillAsset(
  asset: AssetIndex,
  pluginPath: string,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): Promise<boolean> {
  if (!validateCodexAssetName(asset, "skill", diagnostics)) {
    return false;
  }

  const payloadPath = firstPayloadPath(asset);
  const markdown = await readSourceTextFile(payloadPath, diagnostics);

  if (markdown === undefined) {
    return false;
  }
  const rendered = renderAssetPayloadRefs(asset, payloadPath, markdown, "codex", diagnostics);

  if (rendered === undefined) {
    return false;
  }

  const targetPath = join(pluginPath, "skills", asset.name);
  const adapted = adaptCodexSkillMarkdown(
    rendered,
    asset.name,
    `${asset.name} skill`,
    payloadPath,
    diagnostics,
  );

  if (adapted === undefined) {
    return false;
  }

  let copiedFiles = 0;

  if (
    addWriteOperation(
      join(targetPath, "SKILL.md"),
      adapted,
      operations,
      generatedPaths,
      diagnostics,
    )
  ) {
    copiedFiles += 1;
  }

  copiedFiles += await copyAssetSupportFiles(
    asset,
    targetPath,
    new Set([
      resolve(payloadPath),
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

async function planAgentAsset(
  asset: AssetIndex,
  pluginPath: string,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): Promise<boolean> {
  if (!validateCodexAssetName(asset, "agent", diagnostics)) {
    return false;
  }

  const payloadPath = firstPayloadPath(asset);
  const markdown = await readSourceTextFile(payloadPath, diagnostics);

  if (markdown === undefined) {
    return false;
  }
  const rendered = renderAssetPayloadRefs(asset, payloadPath, markdown, "codex", diagnostics);

  if (rendered === undefined) {
    return false;
  }

  return addWriteOperation(
    join(pluginPath, "agents", `${asset.name}.md`),
    ensureTrailingNewline(rendered),
    operations,
    generatedPaths,
    diagnostics,
  );
}

async function copyAssetSupportFiles(
  asset: AssetIndex,
  targetPath: string,
  skippedSourcePaths: Set<string>,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
  isRoot: boolean,
): Promise<number> {
  let copiedFiles = 0;
  const entries = (await readdir(asset.directoryPath, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );

  for (const entry of entries) {
    if (isRoot && entry.name === "ASSET.md") {
      continue;
    }

    const sourceEntryPath = join(asset.directoryPath, entry.name);
    const targetEntryPath = join(targetPath, entry.name);

    if (skippedSourcePaths.has(resolve(sourceEntryPath))) {
      continue;
    }

    if (entry.isDirectory()) {
      copiedFiles += await copyDirectorySupportFiles(
        asset,
        sourceEntryPath,
        targetEntryPath,
        skippedSourcePaths,
        operations,
        generatedPaths,
        diagnostics,
      );
      continue;
    }

    if (!entry.isFile()) {
      diagnostics.push({
        code: "unsupported-codex-skill-entry",
        message: "Codex generation only copies regular skill support files and directories.",
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
          : renderAssetPayloadRefs(asset, sourceEntryPath, markdown, "codex", diagnostics);

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

async function copyDirectorySupportFiles(
  asset: AssetIndex,
  sourcePath: string,
  targetPath: string,
  skippedSourcePaths: Set<string>,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): Promise<number> {
  let copiedFiles = 0;
  const entries = (await readdir(sourcePath, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  for (const entry of entries) {
    const sourceEntryPath = join(sourcePath, entry.name);
    const targetEntryPath = join(targetPath, entry.name);

    if (skippedSourcePaths.has(resolve(sourceEntryPath))) {
      continue;
    }

    if (entry.isDirectory()) {
      copiedFiles += await copyDirectorySupportFiles(
        asset,
        sourceEntryPath,
        targetEntryPath,
        skippedSourcePaths,
        operations,
        generatedPaths,
        diagnostics,
      );
      continue;
    }

    if (!entry.isFile()) {
      diagnostics.push({
        code: "unsupported-codex-skill-entry",
        message: "Codex generation only copies regular skill support files and directories.",
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
          : renderAssetPayloadRefs(asset, sourceEntryPath, markdown, "codex", diagnostics);

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

async function planCodexMarketplace(
  rootPath: string,
  marketplacePath: string,
  entries: readonly CodexMarketplaceEntry[],
  previousOutputs: readonly LockedOutput[],
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const existing = await readCodexMarketplace(marketplacePath);

  if (existing.status === "error") {
    diagnostics.push(existing.diagnostic);
    return;
  }

  const generatedEntriesByName = new Map(entries.map((entry) => [entry.name, entry]));
  const previousGeneratedPackageNames = new Set(
    previousOutputs
      .filter(
        (output) =>
          output.target === "codex" &&
          output.kind === "package" &&
          output.packageName !== undefined,
      )
      .map((output) => output.packageName as string),
  );
  const replacedNames = new Set<string>();
  const preservedEntries: CodexMarketplaceEntry[] = [];

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
  const appendedEntries = entries.filter((entry) => !replacedNames.has(entry.name));
  const marketplace: CodexMarketplace = {
    interface: existing.marketplace.interface,
    name: existing.marketplace.name,
    plugins: [...preservedEntries, ...appendedEntries],
  };
  const diagnostic = await validateCodexMarketplaceEntryPaths(
    rootPath,
    marketplace.plugins,
    marketplacePath,
  );

  if (diagnostic) {
    diagnostics.push(diagnostic);
    return;
  }

  addWriteOperation(
    join(rootPath, CODEX_MARKETPLACE_FILE),
    `${JSON.stringify(marketplace, null, 2)}\n`,
    operations,
    generatedPaths,
    diagnostics,
  );
}

async function removeStaleCodexPackageOutputs(
  rootPath: string,
  previousOutputs: readonly LockedOutput[],
  operations: readonly WriteOperation[],
): Promise<void> {
  for (const staleOutput of staleCodexPackageOutputs(rootPath, previousOutputs, operations)) {
    const path = join(rootPath, staleOutput.path);

    await assertPathDoesNotContainSymlinks(path);
    await rm(path, { force: true });
  }
}

function staleCodexPackageOutputs(
  rootPath: string,
  previousOutputs: readonly LockedOutput[],
  operations: readonly WriteOperation[],
): readonly LockedOutput[] {
  const currentOutputPaths = new Set(
    operations.map((operation) => toPosixPath(relative(rootPath, operation.targetPath))),
  );

  return previousOutputs.filter(
    (output) =>
      output.target === "codex" &&
      output.kind === "package" &&
      !currentOutputPaths.has(output.path),
  );
}

async function validateStaleCodexOutputPath(
  rootPath: string,
  output: LockedOutput,
): Promise<Diagnostic | undefined> {
  if (output.path === "" || output.path.includes("\\") || output.path.split("/").includes("..")) {
    return {
      code: "invalid-stale-codex-output",
      message: `Stale Codex output path must be a safe relative path: ${output.path}.`,
      path: join(rootPath, output.path),
      severity: "error",
    };
  }

  const resolvedRootPath = resolve(rootPath);
  const resolvedPath = resolve(rootPath, output.path);

  if (isOutsideRelativePath(relative(resolvedRootPath, resolvedPath))) {
    return {
      code: "invalid-stale-codex-output",
      message: `Stale Codex output path must stay inside the pack repository: ${output.path}.`,
      path: resolvedPath,
      severity: "error",
    };
  }

  const relativeToCodexOutput = relative(
    resolve(rootPath, CODEX_DEFAULT_OUTPUT_DIRECTORY),
    resolvedPath,
  );

  if (relativeToCodexOutput === "" || isOutsideRelativePath(relativeToCodexOutput)) {
    return {
      code: "invalid-stale-codex-output",
      message: `Stale Codex output path must stay under ${CODEX_DEFAULT_OUTPUT_DIRECTORY}: ${output.path}.`,
      path: resolvedPath,
      severity: "error",
    };
  }

  try {
    await assertPathDoesNotContainSymlinks(resolvedPath);
    const stats = await lstat(resolvedPath);

    if (!stats.isFile()) {
      return {
        code: "invalid-stale-codex-output",
        message: `Stale Codex output path must be a regular file: ${output.path}.`,
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
      code: isSymlinkPathError(error) ? "unsafe-stale-codex-output" : "invalid-stale-codex-output",
      message:
        error instanceof Error ? error.message : "Stale Codex output could not be validated.",
      path: resolvedPath,
      severity: "error",
    };
  }
}

async function readCodexMarketplace(path: string): Promise<ReadMarketplaceResult> {
  let contents: string;

  try {
    await assertPathDoesNotContainSymlinks(path);
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return {
        marketplace: {
          interface: { displayName: "packport Local Packs" },
          name: "packport-local",
          plugins: [],
        },
        status: "ok",
      };
    }

    return {
      diagnostic: {
        code: isSymlinkPathError(error)
          ? "unsafe-codex-marketplace-path"
          : "unreadable-codex-marketplace",
        message:
          error instanceof Error && isSymlinkPathError(error)
            ? error.message
            : "Existing Codex marketplace could not be read.",
        path,
        severity: "error",
      },
      status: "error",
    };
  }

  try {
    const parsed = JSON.parse(contents);
    const marketplace = normalizeCodexMarketplace(parsed);

    if (marketplace) {
      return { marketplace, status: "ok" };
    }
  } catch {
    // Fall through to the common malformed marketplace diagnostic.
  }

  return {
    diagnostic: {
      code: "invalid-codex-marketplace",
      message: "Existing Codex marketplace must contain a valid JSON object with a plugins array.",
      path,
      severity: "error",
    },
    status: "error",
  };
}

function normalizeCodexMarketplace(value: unknown): CodexMarketplace | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const pluginsValue = value.plugins;
  const plugins =
    pluginsValue === undefined
      ? []
      : Array.isArray(pluginsValue)
        ? pluginsValue.filter(isCodexMarketplaceEntry)
        : undefined;

  if (plugins === undefined || plugins.length !== (pluginsValue as unknown[] | undefined)?.length) {
    return undefined;
  }

  const interfaceValue = isRecord(value.interface) ? value.interface : {};
  const displayName =
    typeof interfaceValue.displayName === "string"
      ? interfaceValue.displayName
      : "packport Local Packs";

  return {
    interface: { displayName },
    name: typeof value.name === "string" ? value.name : "packport-local",
    plugins,
  };
}

async function validateCodexMarketplaceEntryPaths(
  rootPath: string,
  entries: readonly CodexMarketplaceEntry[],
  marketplacePath: string,
): Promise<Diagnostic | undefined> {
  const resolvedRootPath = resolve(rootPath);

  for (const entry of entries) {
    if (!isSafeMarketplaceSourcePath(entry.source.path)) {
      return {
        code: "invalid-codex-marketplace-source-path",
        message: `Codex marketplace local source path must be a safe relative path: ${entry.source.path}.`,
        path: marketplacePath,
        severity: "error",
      };
    }

    const resolvedSourcePath = resolve(rootPath, entry.source.path);
    const relativeSourcePath = relative(resolvedRootPath, resolvedSourcePath);

    if (relativeSourcePath === "" || isOutsideRelativePath(relativeSourcePath)) {
      return {
        code: "invalid-codex-marketplace-source-path",
        message: `Codex marketplace local source path must stay inside the pack repository: ${entry.source.path}.`,
        path: marketplacePath,
        severity: "error",
      };
    }

    try {
      await assertPathDoesNotContainSymlinks(resolvedSourcePath);
    } catch (error) {
      return {
        code: isSymlinkPathError(error)
          ? "unsafe-codex-marketplace-source-path"
          : "invalid-codex-marketplace-source-path",
        message:
          error instanceof Error
            ? error.message
            : "Codex marketplace local source path could not be validated.",
        path: marketplacePath,
        severity: "error",
      };
    }
  }

  return undefined;
}

function codexPluginManifest(pack: PackIndex, hasSkills: boolean): CodexPluginManifest {
  const description = pack.description || `${pack.name || pack.id} portable agent pack.`;
  const manifest: CodexPluginManifest = {
    author: { name: "packport" },
    description,
    interface: {
      category: "Productivity",
      developerName: "packport",
      displayName: pack.name || pack.id,
      longDescription: description,
      shortDescription: description,
    },
    license: "UNLICENSED",
    name: pack.id,
    version: pack.version || "0.0.0",
  };

  return hasSkills ? { ...manifest, skills: "./skills/" } : manifest;
}

function codexMarketplaceEntry(
  pack: PackIndex,
  rootPath: string,
  pluginPath: string,
): CodexMarketplaceEntry {
  return {
    category: "Productivity",
    name: pack.id,
    policy: {
      authentication: "ON_INSTALL",
      installation: "AVAILABLE",
    },
    source: {
      path: toMarketplacePath(rootPath, pluginPath),
      source: "local",
    },
  };
}

function adaptCodexSkillMarkdown(
  markdown: string,
  skillName: string,
  fallbackDescription: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): string | undefined {
  const parsed = parseFrontmatter(markdown);
  const description = normalizeSkillDescription(
    parsed.frontmatter.description,
    fallbackDescription,
  );
  const passthroughFrontmatter = Object.fromEntries(
    Object.entries(parsed.frontmatter).filter(([key]) => key !== "name" && key !== "description"),
  );

  if (description.length > 1024) {
    diagnostics.push({
      code: "invalid-codex-skill-description",
      message: "Codex skill descriptions must be 1-1024 characters.",
      path: sourcePath,
      severity: "error",
    });
    return undefined;
  }

  const frontmatter = {
    name: skillName,
    description,
    ...passthroughFrontmatter,
  };

  return `${formatFrontmatter(frontmatter)}${ensureTrailingNewline(parsed.body.replace(/^\n+/, ""))}`;
}

function adaptCodexCommandSkillMarkdown(
  markdown: string,
  skillName: string,
  fallbackDescription: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): string | undefined {
  const parsed = parseFrontmatter(markdown);
  const description = normalizeSkillDescription(
    parsed.frontmatter.description,
    fallbackDescription,
  );

  if (description.length > 1024) {
    diagnostics.push({
      code: "invalid-codex-skill-description",
      message: "Codex skill descriptions must be 1-1024 characters.",
      path: sourcePath,
      severity: "error",
    });
    return undefined;
  }

  return `${formatFrontmatter({ name: skillName, description })}${ensureTrailingNewline(parsed.body.replace(/^\n+/, ""))}`;
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const normalized = markdown.replaceAll("\r\n", "\n");

  if (!normalized.startsWith("---\n")) {
    return { body: normalized, frontmatter: {} };
  }

  const lines = normalized.split("\n");
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");

  if (closingIndex === -1) {
    return { body: normalized, frontmatter: {} };
  }

  const frontmatter: Record<string, string> = {};

  for (const line of lines.slice(1, closingIndex)) {
    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripQuotes(line.slice(separatorIndex + 1).trim());

    if (key !== "") {
      frontmatter[key] = value;
    }
  }

  return { body: lines.slice(closingIndex + 1).join("\n"), frontmatter };
}

function formatFrontmatter(frontmatter: Record<string, string>): string {
  const entries = Object.entries(frontmatter).filter(([, value]) => value !== "");

  if (entries.length === 0) {
    return "";
  }

  return `${["---", ...entries.map(([key, value]) => `${key}: ${serializeFrontmatterValue(value)}`), "---", ""].join("\n")}\n`;
}

function serializeFrontmatterValue(value: string): string {
  if (["true", "false"].includes(value) || /^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }

  if (/^[A-Za-z0-9_./-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function normalizeSkillDescription(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? fallback : normalized;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function firstPayloadPath(asset: AssetIndex): string {
  const payloadPath = asset.payloadPaths[0];

  if (payloadPath === undefined) {
    return join(asset.directoryPath, `${asset.kind.toUpperCase()}.md`);
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
      code: isSymlinkPathError(error) ? "unsafe-codex-source-path" : "unreadable-codex-source-path",
      message: error instanceof Error ? error.message : "Codex source payload could not be read.",
      path,
      severity: "error",
    });
    return undefined;
  }
}

function validateCodexAssetName(
  asset: AssetIndex,
  component: "agent" | "skill",
  diagnostics: Diagnostic[],
): boolean {
  if (isValidCodexName(asset.name)) {
    return true;
  }

  diagnostics.push({
    code: `invalid-codex-${component}-name`,
    message: `Codex ${component} names must be lowercase alphanumeric with single hyphen separators: ${asset.name}.`,
    path: asset.directoryPath,
    severity: "error",
  });
  return false;
}

function validateCodexOutputRoot(rootPath: string, outputPath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const resolvedRootPath = resolve(rootPath);
  const resolvedOutputPath = resolve(outputPath);
  const relativeOutputPath = relative(resolvedRootPath, resolvedOutputPath);
  const firstSegment = relativeOutputPath.split(/[\\/]+/)[0];

  if (
    relativeOutputPath === "" ||
    isOutsideRelativePath(relativeOutputPath) ||
    parse(relativeOutputPath).root !== ""
  ) {
    diagnostics.push({
      code: "invalid-codex-output-path",
      message: "Codex output path must stay inside the pack repository.",
      path: outputPath,
      severity: "error",
    });
    return diagnostics;
  }

  if (firstSegment !== ".packs") {
    diagnostics.push({
      code: "invalid-codex-output-path",
      message: "Codex output path must be under .packs/.",
      path: outputPath,
      severity: "error",
    });
  }

  if (isSameOrInside(resolvedOutputPath, resolve(rootPath, "packs"))) {
    diagnostics.push({
      code: "invalid-codex-output-path",
      message: "Codex output path must not be inside source packs/.",
      path: outputPath,
      severity: "error",
    });
  }

  if (isSameOrInside(resolvedOutputPath, resolve(rootPath, ".agents"))) {
    diagnostics.push({
      code: "invalid-codex-output-path",
      message: "Codex output path must not be inside Codex marketplace metadata.",
      path: outputPath,
      severity: "error",
    });
  }

  return diagnostics;
}

function isSafeMarketplaceSourcePath(value: string): boolean {
  if (!value.startsWith("./") || value.includes("\\")) {
    return false;
  }

  const segments = value.slice(2).split("/");

  return (
    segments.length > 0 &&
    !segments.some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

function isOutsideRelativePath(value: string): boolean {
  return value === ".." || value.startsWith(`..${sep}`) || value.startsWith("../");
}

async function validateGeneratedFilePath(path: string): Promise<Diagnostic | undefined> {
  try {
    await assertWritableFilePath(path);
    return undefined;
  } catch (error) {
    return {
      code: isSymlinkPathError(error) ? "unsafe-codex-target-path" : "unwritable-codex-path",
      message:
        error instanceof Error ? error.message : "Generated Codex path could not be validated.",
      path,
      severity: "error",
    };
  }
}

function addWriteOperation(
  path: string,
  content: string | Uint8Array,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): boolean {
  if (!reserveGeneratedPath(path, generatedPaths, diagnostics)) {
    return false;
  }

  operations.push({ content, kind: "write", targetPath: path });
  return true;
}

function addCopyOperation(
  path: string,
  sourcePath: string,
  operations: WriteOperation[],
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): boolean {
  if (!reserveGeneratedPath(path, generatedPaths, diagnostics)) {
    return false;
  }

  operations.push({ kind: "copy", sourcePath, targetPath: path });
  return true;
}

function reserveGeneratedPath(
  path: string,
  generatedPaths: string[],
  diagnostics: Diagnostic[],
): boolean {
  const absolutePath = resolve(path);
  const conflictingPath = generatedPaths.find(
    (candidate) =>
      candidate === absolutePath ||
      isSameOrInside(candidate, absolutePath) ||
      isSameOrInside(absolutePath, candidate),
  );

  if (conflictingPath !== undefined) {
    diagnostics.push({
      code: "codex-target-collision",
      message: "Multiple pack assets map to the same Codex target path.",
      path,
      severity: "error",
    });
    return false;
  }

  generatedPaths.push(absolutePath);
  return true;
}

async function executeWriteOperation(operation: WriteOperation, files: string[]): Promise<void> {
  await assertWritableFilePath(operation.targetPath);
  await mkdir(dirname(operation.targetPath), { recursive: true });
  await assertWritableFilePath(operation.targetPath);

  if (operation.kind === "copy") {
    await assertPathDoesNotContainSymlinks(operation.sourcePath);
    await writeFile(operation.targetPath, await readFile(operation.sourcePath));
  } else if (typeof operation.content === "string") {
    await writeFile(operation.targetPath, operation.content, "utf8");
  } else {
    await writeFile(operation.targetPath, operation.content);
  }

  files.push(operation.targetPath);
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
        throw new Error(`Generated path must not contain symlinks: ${currentPath}`);
      }

      const isLast = index === segments.length - 1;

      if (!isLast && !stats.isDirectory()) {
        throw new Error(`Generated path parent must be a directory: ${currentPath}`);
      }

      if (isLast && stats.isDirectory()) {
        throw new Error(`Generated file path is an existing directory: ${currentPath}`);
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

function isCodexMarketplaceEntry(value: unknown): value is CodexMarketplaceEntry {
  const installationPolicies = new Set(["AVAILABLE", "INSTALLED_BY_DEFAULT", "NOT_AVAILABLE"]);
  const authenticationPolicies = new Set(["ON_INSTALL", "ON_USE"]);

  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isRecord(value.source) &&
    value.source.source === "local" &&
    typeof value.source.path === "string" &&
    isRecord(value.policy) &&
    installationPolicies.has(String(value.policy.installation)) &&
    authenticationPolicies.has(String(value.policy.authentication)) &&
    (value.category === undefined || typeof value.category === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isSymlinkPathError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith("Generated path must not contain symlinks:")
  );
}

function isSameOrInside(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}${sep}`);
}

function isValidCodexName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

function toMarketplacePath(rootPath: string, pluginPath: string): string {
  return `./${toPosixPath(relative(rootPath, pluginPath))}`;
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}
