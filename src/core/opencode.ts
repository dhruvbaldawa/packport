// ABOUTME: Generates one OpenCode repo-local package per portable source pack.
// ABOUTME: Adapts command and agent markdown while copying skill payload directories.

import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { isBuiltInControlPack } from "./control-packs";
import { discoverPackRepository } from "./discovery";
import { readPackLock, writePackGenerationLock, type LockedOutput } from "./lockfile";
import { isAssetPayloadPath, renderAssetPayloadRefs } from "./payload-refs";
import type { AssetIndex, Diagnostic, PackIndex } from "./types";

export type GenerateOpenCodeResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly files: readonly string[];
  readonly outputPath: string;
  readonly rootPath: string;
  readonly summary: {
    readonly agents: number;
    readonly commands: number;
    readonly files: number;
    readonly packages: number;
    readonly skills: number;
  };
};

export type GenerateOpenCodeOptions = {
  readonly includeControlPacks?: boolean;
};

type ParsedFrontmatter = {
  readonly body: string;
  readonly frontmatter: Record<string, string>;
};

type ReadJsonObjectResult =
  | { readonly status: "ok"; readonly value: Record<string, unknown> }
  | { readonly diagnostic: Diagnostic; readonly status: "error" };

type WriteOperation =
  | { readonly content: string | Uint8Array; readonly kind: "write"; readonly targetPath: string }
  | { readonly kind: "copy"; readonly sourcePath: string; readonly targetPath: string };

const OPENCODE_SCHEMA = "https://opencode.ai/config.json";
const OPENCODE_DEFAULT_OUTPUT_DIRECTORY = join(".packs", "opencode");
const PACKPORT_TOOL_VERSION = "0.0.0";

/** Generates repo-local OpenCode files under outputPath from portable pack source. */
export async function generateOpenCodeOutput(
  rootPath: string,
  outputPath: string,
  options: GenerateOpenCodeOptions = {},
): Promise<GenerateOpenCodeResult> {
  const discovery = await discoverPackRepository(rootPath);
  const diagnostics: Diagnostic[] = [...discovery.diagnostics];
  const files: string[] = [];
  let commands = 0;
  let agents = 0;
  let skills = 0;
  let packages = 0;
  const generatedPaths = new Set<string>();
  const operations: WriteOperation[] = [];
  let lockDecisions: readonly string[] = [];
  let preservedOutputs: readonly LockedOutput[] = [];

  diagnostics.push(...validateOpenCodeOutputRoot(rootPath, outputPath));

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    const lockResult = await readPackLock(rootPath);
    diagnostics.push(...lockResult.diagnostics);
    lockDecisions = lockResult.lock?.decisions ?? [];
    preservedOutputs = lockResult.lock?.outputs ?? [];
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    for (const pack of userGenerationPacks(discovery.index.packs, options.includeControlPacks)) {
      const plan = await planOpenCodePackage(
        pack,
        outputPath,
        operations,
        generatedPaths,
        diagnostics,
      );

      agents += plan.agents;
      commands += plan.commands;
      packages += plan.packages;
      skills += plan.skills;
    }
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    for (const operation of operations) {
      const diagnostic = await validateGeneratedPath(operation.targetPath);

      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
    }

    for (const staleOutput of staleOpenCodeOutputs(rootPath, preservedOutputs, operations)) {
      const diagnostic = await validateStaleOpenCodeOutputPath(rootPath, staleOutput);

      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    commands = 0;
    agents = 0;
    packages = 0;
    skills = 0;
  } else {
    await removeStaleOpenCodeOutputs(rootPath, preservedOutputs, operations);

    for (const operation of operations) {
      await executeWriteOperation(operation, files);
    }

    await writePackGenerationLock(
      rootPath,
      discovery.index,
      PACKPORT_TOOL_VERSION,
      files.map((file) => openCodeGeneratedOutput(file, outputPath)),
      "opencode",
      lockDecisions,
      preservedOutputs,
    );
  }

  return {
    diagnostics,
    files,
    outputPath,
    rootPath,
    summary: { agents, commands, files: files.length, packages, skills },
  };
}

type OpenCodePackagePlan = {
  readonly agents: number;
  readonly commands: number;
  readonly packages: number;
  readonly skills: number;
};

function openCodeGeneratedOutput(
  path: string,
  outputPath: string,
): {
  readonly kind: "package";
  readonly packageName?: string;
  readonly path: string;
  readonly target: "opencode";
} {
  const [packageName] = relative(outputPath, path).split(sep);

  return {
    kind: "package",
    ...(packageName ? { packageName } : {}),
    path,
    target: "opencode",
  };
}

async function planOpenCodePackage(
  pack: PackIndex,
  outputPath: string,
  operations: WriteOperation[],
  generatedPaths: Set<string>,
  diagnostics: Diagnostic[],
): Promise<OpenCodePackagePlan> {
  if (!isValidOpenCodePackageName(pack.id)) {
    diagnostics.push({
      code: "invalid-opencode-package-name",
      message: `OpenCode package names must be lowercase alphanumeric with single hyphen separators: ${pack.id}.`,
      path: pack.directoryPath,
      severity: "error",
    });
    return { agents: 0, commands: 0, packages: 0, skills: 0 };
  }

  const packagePath = join(outputPath, pack.id);
  const configDiagnostic = await planOpenCodeConfig(packagePath, operations);
  let commands = 0;
  let agents = 0;
  let skills = 0;

  if (configDiagnostic) {
    diagnostics.push(configDiagnostic);
  }

  for (const asset of pack.assets) {
    if (asset.kind === "command") {
      const generated = await writeAdaptedMarkdownAsset(
        asset,
        packagePath,
        "commands",
        adaptCommandMarkdown,
        operations,
        generatedPaths,
        diagnostics,
      );

      if (generated) {
        commands += 1;
      }
      continue;
    }

    if (asset.kind === "agent") {
      const generated = await writeAdaptedMarkdownAsset(
        asset,
        packagePath,
        "agents",
        adaptAgentMarkdown,
        operations,
        generatedPaths,
        diagnostics,
      );

      if (generated) {
        agents += 1;
      }
      continue;
    }

    if (asset.kind === "skill") {
      const generated = await copySkillAsset(
        asset,
        packagePath,
        operations,
        generatedPaths,
        diagnostics,
      );

      if (generated) {
        skills += 1;
      }
      continue;
    }

    diagnostics.push({
      code: "unsupported-opencode-asset",
      message: `OpenCode generation does not support ${asset.kind} assets yet.`,
      path: asset.directoryPath,
      severity: "warning",
    });
  }

  return { agents, commands, packages: 1, skills };
}

async function removeStaleOpenCodeOutputs(
  rootPath: string,
  previousOutputs: readonly LockedOutput[],
  operations: readonly WriteOperation[],
): Promise<void> {
  for (const staleOutput of staleOpenCodeOutputs(rootPath, previousOutputs, operations)) {
    const path = join(rootPath, staleOutput.path);

    await assertPathDoesNotContainSymlinks(path);
    await rm(path, { force: true });
  }
}

function staleOpenCodeOutputs(
  rootPath: string,
  previousOutputs: readonly LockedOutput[],
  operations: readonly WriteOperation[],
): readonly LockedOutput[] {
  const currentOutputPaths = new Set(
    operations.map((operation) => toPosixPath(relative(rootPath, operation.targetPath))),
  );

  return previousOutputs.filter(
    (output) =>
      output.target === "opencode" &&
      output.kind === "package" &&
      !currentOutputPaths.has(output.path),
  );
}

async function validateStaleOpenCodeOutputPath(
  rootPath: string,
  output: LockedOutput,
): Promise<Diagnostic | undefined> {
  if (output.path === "" || output.path.includes("\\") || output.path.split("/").includes("..")) {
    return {
      code: "invalid-stale-opencode-output",
      message: `Stale OpenCode output path must be a safe relative path: ${output.path}.`,
      path: join(rootPath, output.path),
      severity: "error",
    };
  }

  const resolvedRootPath = resolve(rootPath);
  const resolvedPath = resolve(rootPath, output.path);

  if (isOutsideRelativePath(relative(resolvedRootPath, resolvedPath))) {
    return {
      code: "invalid-stale-opencode-output",
      message: `Stale OpenCode output path must stay inside the pack repository: ${output.path}.`,
      path: resolvedPath,
      severity: "error",
    };
  }

  const relativeToOpenCodeOutput = relative(
    resolve(rootPath, OPENCODE_DEFAULT_OUTPUT_DIRECTORY),
    resolvedPath,
  );

  if (relativeToOpenCodeOutput === "" || isOutsideRelativePath(relativeToOpenCodeOutput)) {
    return {
      code: "invalid-stale-opencode-output",
      message: `Stale OpenCode output path must stay under ${OPENCODE_DEFAULT_OUTPUT_DIRECTORY}: ${output.path}.`,
      path: resolvedPath,
      severity: "error",
    };
  }

  try {
    await assertPathDoesNotContainSymlinks(resolvedPath);
    const stats = await lstat(resolvedPath);

    if (!stats.isFile()) {
      return {
        code: "invalid-stale-opencode-output",
        message: `Stale OpenCode output path must be a regular file: ${output.path}.`,
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
      code: isSymlinkPathError(error)
        ? "unsafe-stale-opencode-output"
        : "invalid-stale-opencode-output",
      message:
        error instanceof Error ? error.message : "Stale OpenCode output could not be validated.",
      path: resolvedPath,
      severity: "error",
    };
  }
}

function userGenerationPacks(
  packs: readonly PackIndex[],
  includeControlPacks = false,
): readonly PackIndex[] {
  return includeControlPacks ? packs : packs.filter((pack) => !isBuiltInControlPack(pack.id));
}

/** Ensures generated OpenCode outputs are repo-owned and lockfile-trackable. */
function validateOpenCodeOutputRoot(rootPath: string, outputPath: string): Diagnostic[] {
  const expectedPath = resolve(rootPath, OPENCODE_DEFAULT_OUTPUT_DIRECTORY);

  if (resolve(outputPath) === expectedPath) {
    return [];
  }

  return [
    {
      code: "invalid-opencode-output-root",
      message: `OpenCode output must be written to ${OPENCODE_DEFAULT_OUTPUT_DIRECTORY} under the pack repository.`,
      path: outputPath,
      severity: "error",
    },
  ];
}

/** Plans a minimal repo-local OpenCode config while preserving existing unmanaged keys. */
async function planOpenCodeConfig(
  outputPath: string,
  operations: WriteOperation[],
): Promise<Diagnostic | undefined> {
  const configPath = join(outputPath, "opencode.json");
  const config = await readJsonObject(configPath);

  if (config.status === "error") {
    return config.diagnostic;
  }

  const nextConfig = { ...config.value, $schema: OPENCODE_SCHEMA };
  operations.push({
    content: `${JSON.stringify(nextConfig, null, 2)}\n`,
    kind: "write",
    targetPath: configPath,
  });
  return undefined;
}

/** Writes one command or agent markdown file after applying OpenCode markdown adaptation. */
async function writeAdaptedMarkdownAsset(
  asset: AssetIndex,
  outputPath: string,
  directoryName: "agents" | "commands",
  adapt: (markdown: string, fallbackDescription: string) => string,
  operations: WriteOperation[],
  generatedPaths: Set<string>,
  diagnostics: Diagnostic[],
): Promise<boolean> {
  const payloadPath = firstPayloadPath(asset);
  const markdown = await readFile(payloadPath, "utf8");
  const rendered = renderAssetPayloadRefs(asset, payloadPath, markdown, "opencode", diagnostics);
  const targetPath = join(outputPath, ".opencode", directoryName, `${asset.name}.md`);

  if (rendered === undefined) {
    return false;
  }

  return addWriteOperation(
    targetPath,
    adapt(rendered, `${asset.name} ${asset.kind}`),
    operations,
    generatedPaths,
    diagnostics,
  );
}

/** Copies a portable skill directory into the generated OpenCode repo-local skill tree. */
async function copySkillAsset(
  asset: AssetIndex,
  outputPath: string,
  operations: WriteOperation[],
  generatedPaths: Set<string>,
  diagnostics: Diagnostic[],
): Promise<boolean> {
  if (!isValidOpenCodeSkillName(asset.name)) {
    diagnostics.push({
      code: "invalid-opencode-skill-name",
      message: `OpenCode skill names must be lowercase alphanumeric with single hyphen separators: ${asset.name}.`,
      path: asset.directoryPath,
      severity: "error",
    });
    return false;
  }

  const targetPath = join(outputPath, ".opencode", "skills", asset.name);
  const targetSkillPath = join(targetPath, "SKILL.md");
  const primaryPayloadPath = firstPayloadPath(asset);
  const skippedSourcePaths = new Set([
    resolve(primaryPayloadPath),
    resolve(join(asset.directoryPath, "SKILL.md")),
  ]);
  const markdown = await readFile(primaryPayloadPath, "utf8");
  const rendered = renderAssetPayloadRefs(
    asset,
    primaryPayloadPath,
    markdown,
    "opencode",
    diagnostics,
  );
  const adapted =
    rendered === undefined
      ? undefined
      : adaptSkillMarkdown(rendered, asset.name, primaryPayloadPath, diagnostics);
  let copiedFiles = 0;

  if (!reserveGeneratedPath(targetPath, generatedPaths, diagnostics)) {
    return false;
  }

  if (
    adapted !== undefined &&
    addWriteOperation(targetSkillPath, adapted, operations, generatedPaths, diagnostics)
  ) {
    copiedFiles += 1;
  }

  copiedFiles += await copySkillDirectory(
    asset,
    asset.directoryPath,
    targetPath,
    skippedSourcePaths,
    operations,
    generatedPaths,
    diagnostics,
    true,
  );

  return copiedFiles > 0;
}

/** Copies skill files recursively while excluding packport source metadata. */
async function copySkillDirectory(
  asset: AssetIndex,
  sourcePath: string,
  targetPath: string,
  skippedSourcePaths: Set<string>,
  operations: WriteOperation[],
  generatedPaths: Set<string>,
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
        code: "unsupported-opencode-skill-entry",
        message: "OpenCode generation only copies regular skill files and directories.",
        path: sourceEntryPath,
        severity: "warning",
      });
      continue;
    }

    if (isAssetPayloadPath(asset, sourceEntryPath)) {
      const markdown = await readFile(sourceEntryPath, "utf8");
      const rendered = renderAssetPayloadRefs(
        asset,
        sourceEntryPath,
        markdown,
        "opencode",
        diagnostics,
      );

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

/** Adapts portable skill Markdown to OpenCode's required skill frontmatter. */
function adaptSkillMarkdown(
  markdown: string,
  skillName: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): string | undefined {
  const parsed = parseFrontmatter(markdown);
  const description = normalizeSkillDescription(
    parsed.frontmatter.description,
    `${skillName} skill`,
  );

  if (description.length > 1024) {
    diagnostics.push({
      code: "invalid-opencode-skill-description",
      message: "OpenCode skill descriptions must be 1-1024 characters.",
      path: sourcePath,
      severity: "error",
    });
    return undefined;
  }

  const frontmatter: Record<string, string> = {
    name: skillName,
    description,
  };

  for (const key of ["license", "compatibility"]) {
    const value = parsed.frontmatter[key];

    if (value !== undefined && value.trim() !== "") {
      frontmatter[key] = value;
    }
  }

  return `${formatFrontmatter(frontmatter)}${ensureTrailingNewline(parsed.body.replace(/^\n+/, ""))}`;
}

/** Returns the primary payload path for one single-payload OpenCode asset. */
function firstPayloadPath(asset: AssetIndex): string {
  const payloadPath = asset.payloadPaths[0];

  if (payloadPath === undefined) {
    return join(asset.directoryPath, `${asset.kind.toUpperCase()}.md`);
  }

  return payloadPath;
}

/** Adapts command markdown to OpenCode command frontmatter and argument syntax. */
function adaptCommandMarkdown(markdown: string, fallbackDescription: string): string {
  const parsed = parseFrontmatter(markdown);
  const frontmatter: Record<string, string> = {
    description: parsed.frontmatter.description ?? fallbackDescription,
  };

  for (const key of ["agent", "model", "subtask"]) {
    const value = parsed.frontmatter[key];

    if (value !== undefined) {
      frontmatter[key] = key === "model" ? toOpenCodeModelId(value) : value;
    }
  }

  const body = normalizeCommandTemplate(parsed.body).replace(/^\n+/, "");
  return `${formatFrontmatter(frontmatter)}${ensureTrailingNewline(body)}`;
}

/** Adapts agent markdown to OpenCode subagent frontmatter. */
function adaptAgentMarkdown(markdown: string, fallbackDescription: string): string {
  const parsed = parseFrontmatter(markdown);
  const frontmatter: Record<string, string> = {
    description: parsed.frontmatter.description ?? fallbackDescription,
    mode: parsed.frontmatter.mode ?? "subagent",
  };

  for (const key of ["model", "temperature", "hidden"]) {
    const value = parsed.frontmatter[key];

    if (value !== undefined) {
      frontmatter[key] = key === "model" ? toOpenCodeModelId(value) : value;
    }
  }

  const color = parsed.frontmatter.color
    ? normalizeAgentColor(parsed.frontmatter.color)
    : undefined;

  if (color !== undefined) {
    frontmatter.color = color;
  }

  return `${formatFrontmatter(frontmatter)}${ensureTrailingNewline(parsed.body.replace(/^\n+/, ""))}`;
}

/** Parses simple YAML-style string frontmatter from Markdown payloads. */
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

/** Serializes OpenCode-safe frontmatter. */
function formatFrontmatter(frontmatter: Record<string, string>): string {
  const entries = Object.entries(frontmatter).filter(([, value]) => value !== "");

  if (entries.length === 0) {
    return "";
  }

  return `${["---", ...entries.map(([key, value]) => `${key}: ${serializeFrontmatterValue(value)}`), "---", ""].join("\n")}\n`;
}

/** Quotes frontmatter values only when plain scalar syntax is unsafe. */
function serializeFrontmatterValue(value: string): string {
  if (["true", "false"].includes(value) || /^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }

  if (/^[A-Za-z0-9_./-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

/** Converts Claude command argument placeholders to OpenCode's placeholder. */
function normalizeCommandTemplate(template: string): string {
  return template.replace(/\$\{\{\{ARGS\}\}\}/g, "$ARGUMENTS").replace(/\$ARGS\b/g, "$ARGUMENTS");
}

/** Converts common Anthropic shorthand model IDs to OpenCode provider-qualified IDs. */
function toOpenCodeModelId(model: string): string {
  if (model === "inherit" || model.includes("/")) {
    return model;
  }

  if (model.startsWith("claude-")) {
    return `anthropic/${model}`;
  }

  return model;
}

/** Normalizes common Claude color names to OpenCode theme color names. */
function normalizeAgentColor(color: string): string | undefined {
  const aliases: Record<string, string> = {
    amber: "warning",
    blue: "info",
    cyan: "info",
    gray: "secondary",
    green: "success",
    grey: "secondary",
    lime: "success",
    magenta: "accent",
    orange: "warning",
    pink: "accent",
    purple: "accent",
    red: "error",
    teal: "info",
    yellow: "warning",
  };
  const normalized = color.trim().toLowerCase();
  const themeColors = new Set([
    "accent",
    "error",
    "info",
    "primary",
    "secondary",
    "success",
    "warning",
  ]);

  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized) || themeColors.has(normalized)) {
    return normalized;
  }

  return aliases[normalized];
}

/** Checks OpenCode's native skill-name grammar. */
function isValidOpenCodeSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

/** Checks pack directory names before using them as generated OpenCode package names. */
function isValidOpenCodePackageName(name: string): boolean {
  return isValidOpenCodeSkillName(name);
}

/** Falls back when a portable skill has no OpenCode-compatible description. */
function normalizeSkillDescription(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? fallback : normalized;
}

/** Removes one layer of quotes from a frontmatter scalar. */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

/** Adds a final newline to generated Markdown when needed. */
function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

/** Reads an existing JSON object without discarding malformed target config. */
async function readJsonObject(path: string): Promise<ReadJsonObjectResult> {
  let contents: string;

  try {
    await assertPathDoesNotContainSymlinks(path);
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: "ok", value: {} };
    }

    return {
      diagnostic: {
        code: isSymlinkPathError(error)
          ? "unsafe-opencode-target-path"
          : "unreadable-opencode-config",
        message:
          error instanceof Error && isSymlinkPathError(error)
            ? error.message
            : "Existing opencode.json could not be read.",
        path,
        severity: "error",
      },
      status: "error",
    };
  }

  try {
    const parsed = JSON.parse(contents);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { status: "ok", value: parsed };
    }

    return {
      diagnostic: {
        code: "invalid-opencode-config",
        message: "Existing opencode.json must contain a JSON object.",
        path,
        severity: "error",
      },
      status: "error",
    };
  } catch {
    return {
      diagnostic: {
        code: "invalid-opencode-config",
        message: "Existing opencode.json must contain valid JSON.",
        path,
        severity: "error",
      },
      status: "error",
    };
  }
}

/** Converts an unsafe generated target path into a diagnostic before any writes occur. */
async function validateGeneratedPath(path: string): Promise<Diagnostic | undefined> {
  try {
    await assertPathDoesNotContainSymlinks(path);
    return undefined;
  } catch (error) {
    return {
      code: isSymlinkPathError(error) ? "unsafe-opencode-target-path" : "unwritable-opencode-path",
      message:
        error instanceof Error ? error.message : "Generated OpenCode path could not be validated.",
      path,
      severity: "error",
    };
  }
}

/** Adds a planned write after checking generated target collisions. */
function addWriteOperation(
  path: string,
  content: string | Uint8Array,
  operations: WriteOperation[],
  generatedPaths: Set<string>,
  diagnostics: Diagnostic[],
): boolean {
  if (!reserveGeneratedPath(path, generatedPaths, diagnostics)) {
    return false;
  }

  operations.push({ content, kind: "write", targetPath: path });
  return true;
}

/** Adds a planned file copy after checking generated target collisions. */
function addCopyOperation(
  path: string,
  sourcePath: string,
  operations: WriteOperation[],
  generatedPaths: Set<string>,
  diagnostics: Diagnostic[],
): boolean {
  if (!reserveGeneratedPath(path, generatedPaths, diagnostics)) {
    return false;
  }

  operations.push({ kind: "copy", sourcePath, targetPath: path });
  return true;
}

/** Executes one validated write operation and records the generated file path. */
async function executeWriteOperation(operation: WriteOperation, files: string[]): Promise<void> {
  await assertPathDoesNotContainSymlinks(operation.targetPath);
  await mkdir(dirname(operation.targetPath), { recursive: true });
  await assertPathDoesNotContainSymlinks(operation.targetPath);

  if (operation.kind === "copy") {
    await writeFile(operation.targetPath, await readFile(operation.sourcePath));
  } else if (typeof operation.content === "string") {
    await writeFile(operation.targetPath, operation.content, "utf8");
  } else {
    await writeFile(operation.targetPath, operation.content);
  }

  files.push(operation.targetPath);
}

/** Narrows Node filesystem errors that represent missing paths. */
function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Identifies errors raised by generated symlink path checks. */
function isSymlinkPathError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith("Generated path must not contain symlinks:")
  );
}

function isOutsideRelativePath(value: string): boolean {
  return value === ".." || value.startsWith(`..${sep}`) || value.startsWith("../");
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
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

/** Prevents one generation run from silently overwriting two assets into one target path. */
function reserveGeneratedPath(
  path: string,
  generatedPaths: Set<string>,
  diagnostics: Diagnostic[],
): boolean {
  if (generatedPaths.has(path)) {
    diagnostics.push({
      code: "opencode-target-collision",
      message: "Multiple pack assets map to the same OpenCode target path.",
      path,
      severity: "error",
    });
    return false;
  }

  generatedPaths.add(path);
  return true;
}
