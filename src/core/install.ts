// ABOUTME: Installs generated packport output into target-tool global configuration roots.
// ABOUTME: Keeps repo-local generation deterministic while adapters own user-machine wiring.

import { cp, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { generateClaudeOutput } from "./claude";
import { generateCodexOutput } from "./codex";
import { materializeConfigportInstructions, readConfigportState } from "./configport";
import type { HarnessTarget } from "./harness-refs";
import { mergeManagedBlock, removeManagedBlock } from "./mcp";
import { generateOpenCodeOutput } from "./opencode";
import type { Diagnostic } from "./types";

export const INSTALL_TARGETS = ["claude", "opencode", "codex"] as const;

export type InstallTarget = (typeof INSTALL_TARGETS)[number];

export type InstallPackRepositoryOptions = {
  readonly agentsRootPath?: string;
  readonly claudeHomePath?: string;
  readonly codexHomePath?: string;
  readonly dryRun?: boolean;
  readonly materializeConfigport?: boolean;
  readonly opencodeConfigRootPath?: string;
  readonly targets?: readonly InstallTarget[];
};

export type InstallPlanWrite = {
  readonly description: string;
  readonly path: string;
};

export type InstallPackRepositoryResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly dryRun: boolean;
  readonly rootPath: string;
  readonly summaries: readonly string[];
  readonly writes: readonly InstallPlanWrite[];
};

type PlannedWrite =
  | {
      readonly content: string | Uint8Array;
      readonly description: string;
      readonly kind: "write";
      readonly path: string;
    }
  | {
      readonly description: string;
      readonly kind: "copy";
      readonly path: string;
      readonly sourcePath: string;
    }
  | {
      readonly description: string;
      readonly kind: "remove";
      readonly path: string;
    };

type JsonReadResult =
  | { readonly status: "missing" }
  | { readonly status: "ok"; readonly value: Record<string, unknown> }
  | { readonly diagnostic: Diagnostic; readonly status: "error" };

type CodexMarketplace = {
  readonly interface?: Record<string, unknown>;
  readonly name: string;
  readonly plugins: readonly CodexMarketplaceEntry[];
};

type CodexMarketplaceEntry = {
  readonly name: string;
  readonly source?: { readonly path?: string; readonly source?: string };
  readonly [key: string]: unknown;
};

type ClaudeMarketplace = {
  readonly name: string;
  readonly plugins: readonly ClaudeMarketplaceEntry[];
};

type ClaudeMarketplaceEntry = {
  readonly name: string;
  readonly source: string;
  readonly [key: string]: unknown;
};

const CODEX_MCP_BLOCK_START = "# packport-managed-codex-mcp:start";
const CODEX_MCP_BLOCK_END = "# packport-managed-codex-mcp:end";
const CODEX_PLUGINS_BLOCK_START = "# packport-managed-codex-plugins:start";
const CODEX_PLUGINS_BLOCK_END = "# packport-managed-codex-plugins:end";
const OPENCODE_INSTALL_STATE_FILE = join(".packport", "install.json");
const OPENCODE_LEGACY_STATE_FILE = ".ccconfigs-opencode-state.json";
const OPENCODE_SCHEMA = "https://opencode.ai/config.json";

/** Installs selected generated target output into target-tool global configuration roots. */
export async function installPackRepository(
  rootPath: string,
  options: InstallPackRepositoryOptions = {},
): Promise<InstallPackRepositoryResult> {
  const targets = normalizeTargets(options.targets);
  const dryRun = options.dryRun === true;
  const materializeConfigport = options.materializeConfigport !== false;
  const diagnostics: Diagnostic[] = [];
  const summaries: string[] = [];
  const writes: PlannedWrite[] = [];
  const absoluteRootPath = resolve(rootPath);

  for (const target of targets) {
    if (!dryRun) {
      diagnostics.push(...(await generateTarget(absoluteRootPath, target, summaries)));
    } else {
      summaries.push(`Would install ${target} output from ${absoluteRootPath}.`);
    }

    if (hasErrorDiagnostics(diagnostics)) {
      continue;
    }

    if (target === "claude") {
      await planClaudeInstall(absoluteRootPath, options, writes, diagnostics);
      continue;
    }

    if (target === "opencode") {
      await planOpenCodeInstall(
        absoluteRootPath,
        options,
        materializeConfigport,
        writes,
        diagnostics,
      );
      continue;
    }

    await planCodexInstall(absoluteRootPath, options, writes, diagnostics);
  }

  if (!hasErrorDiagnostics(diagnostics)) {
    await validatePlannedWrites(writes, diagnostics, [absoluteRootPath]);
  }

  if (!dryRun && !hasErrorDiagnostics(diagnostics)) {
    for (const write of writes) {
      await applyPlannedWrite(write);
    }

    if (materializeConfigport) {
      for (const target of targets) {
        diagnostics.push(
          ...(await materializeInstallInstructions(absoluteRootPath, target, options)),
        );
      }
    }
  } else if (dryRun && materializeConfigport && !hasErrorDiagnostics(diagnostics)) {
    for (const target of targets) {
      summaries.push(...(await dryRunInstructionSummaries(absoluteRootPath, target, options)));
    }
  }

  return {
    diagnostics,
    dryRun,
    rootPath: absoluteRootPath,
    summaries,
    writes: writes.map((write) => ({ description: write.description, path: write.path })),
  };
}

function normalizeTargets(targets: readonly InstallTarget[] | undefined): readonly InstallTarget[] {
  if (targets === undefined || targets.length === 0) {
    return INSTALL_TARGETS;
  }

  const selected = new Set(targets);
  return INSTALL_TARGETS.filter((target) => selected.has(target));
}

async function generateTarget(
  rootPath: string,
  target: InstallTarget,
  summaries: string[],
): Promise<readonly Diagnostic[]> {
  if (target === "claude") {
    const result = await generateClaudeOutput(rootPath, undefined, { includeControlPacks: true });
    summaries.push(
      `Generated Claude output at ${result.outputPath} with ${result.summary.plugins} plugin(s), ${result.summary.commands} command(s), ${result.summary.agents} agent(s), ${result.summary.skills} skill(s), and ${result.summary.marketplaceEntries} marketplace entry(s).`,
    );
    return result.diagnostics;
  }

  if (target === "opencode") {
    const result = await generateOpenCodeOutput(rootPath, join(rootPath, ".packs", "opencode"), {
      includeControlPacks: true,
    });
    summaries.push(
      `Generated OpenCode output at ${result.outputPath} with ${result.summary.packages} package(s), ${result.summary.commands} command(s), ${result.summary.agents} agent(s), and ${result.summary.skills} skill(s).`,
    );
    return result.diagnostics;
  }

  const result = await generateCodexOutput(rootPath, undefined, { includeControlPacks: true });
  summaries.push(
    `Generated Codex output at ${result.outputPath} with ${result.summary.plugins} plugin(s), ${result.summary.skills} skill(s), ${result.summary.agents} agent(s), and ${result.summary.marketplaceEntries} marketplace entry(s).`,
  );
  return result.diagnostics;
}

async function planCodexInstall(
  rootPath: string,
  options: InstallPackRepositoryOptions,
  writes: PlannedWrite[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const codexHomePath = resolve(
    options.codexHomePath ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
  );
  const agentsRootPath = resolve(options.agentsRootPath ?? homedir());
  const sourceMarketplacePath = join(rootPath, ".agents", "plugins", "marketplace.json");
  const targetMarketplacePath = join(agentsRootPath, ".agents", "plugins", "marketplace.json");
  const codexConfigPath = join(codexHomePath, "config.toml");
  const marketplace = await readCodexMarketplace(sourceMarketplacePath, diagnostics);

  if (!marketplace) {
    return;
  }

  const personalMarketplace = {
    ...marketplace,
    plugins: marketplace.plugins.map((plugin) => ({
      ...plugin,
      source: {
        path: resolve(rootPath, plugin.source?.path ?? join(".packs", "codex", plugin.name)),
        source: "local",
      },
    })),
  };
  writes.push({
    content: `${JSON.stringify(personalMarketplace, null, 2)}\n`,
    description: "Install Codex personal marketplace",
    kind: "write",
    path: targetMarketplacePath,
  });

  const existingConfig = await readOptionalText(codexConfigPath, diagnostics);

  if (existingConfig === undefined) {
    return;
  }

  let nextConfig = mergeCodexPluginBlock(
    existingConfig,
    marketplace.name,
    marketplace.plugins.map((plugin) => plugin.name),
    codexConfigPath,
    diagnostics,
  );

  const generatedMcpConfig = await readOptionalText(
    join(rootPath, ".codex", "config.toml"),
    diagnostics,
  );
  const generatedMcpBlock = generatedMcpConfig
    ? extractManagedBlock(generatedMcpConfig, CODEX_MCP_BLOCK_START, CODEX_MCP_BLOCK_END)
    : undefined;

  if (generatedMcpBlock !== undefined) {
    nextConfig = mergeManagedBlock(
      nextConfig,
      CODEX_MCP_BLOCK_START,
      CODEX_MCP_BLOCK_END,
      generatedMcpBlock,
    );
  }

  writes.push({
    content: ensureTrailingNewline(nextConfig),
    description: "Install Codex config",
    kind: "write",
    path: codexConfigPath,
  });
}

async function planClaudeInstall(
  rootPath: string,
  options: InstallPackRepositoryOptions,
  writes: PlannedWrite[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const claudeHomePath = resolve(options.claudeHomePath ?? join(homedir(), ".claude"));
  const settingsPath = join(claudeHomePath, "settings.json");
  const marketplace = await readClaudeMarketplace(
    join(rootPath, ".claude-plugin", "marketplace.json"),
    diagnostics,
  );

  if (!marketplace) {
    return;
  }

  const settingsResult = await readJsonObject(settingsPath);
  const settings =
    settingsResult.status === "ok"
      ? settingsResult.value
      : settingsResult.status === "missing"
        ? {}
        : undefined;

  if (settingsResult.status === "error") {
    diagnostics.push(settingsResult.diagnostic);
  }

  if (settings === undefined) {
    return;
  }

  const extraKnownMarketplaces = objectField(
    settings.extraKnownMarketplaces,
    settingsPath,
    diagnostics,
    "extraKnownMarketplaces",
  );
  const enabledPlugins = objectField(
    settings.enabledPlugins,
    settingsPath,
    diagnostics,
    "enabledPlugins",
  );

  if (!extraKnownMarketplaces || !enabledPlugins) {
    return;
  }

  extraKnownMarketplaces[marketplace.name] = {
    source: {
      path: rootPath,
      source: "directory",
    },
  };

  for (const plugin of marketplace.plugins) {
    enabledPlugins[`${plugin.name}@${marketplace.name}`] = true;
  }

  settings.extraKnownMarketplaces = sortRecord(extraKnownMarketplaces);
  settings.enabledPlugins = sortRecord(enabledPlugins);

  writes.push({
    content: `${JSON.stringify(sortRecord(settings), null, 2)}\n`,
    description: "Install Claude settings",
    kind: "write",
    path: settingsPath,
  });
}

async function planOpenCodeInstall(
  rootPath: string,
  options: InstallPackRepositoryOptions,
  materializeConfigport: boolean,
  writes: PlannedWrite[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const configRootPath = resolve(
    options.opencodeConfigRootPath ??
      join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode"),
  );
  const outputRootPath = join(rootPath, ".packs", "opencode");
  const packageNames = await safeDirectoryNames(outputRootPath, diagnostics);
  const mcp: Record<string, unknown> = {};
  const ownedFiles = await readOpenCodeOwnedFiles(configRootPath);
  const nextOwnedFiles = new Set<string>();

  for (const packageName of packageNames) {
    const packagePath = join(outputRootPath, packageName);
    const config = await readJsonObject(join(packagePath, "opencode.json"));

    if (config.status === "error") {
      diagnostics.push(config.diagnostic);
      continue;
    }

    if (config.status === "ok" && isRecord(config.value.mcp)) {
      Object.assign(mcp, config.value.mcp);
    }

    await planOpenCodeAssetCopies(
      packagePath,
      configRootPath,
      ownedFiles,
      nextOwnedFiles,
      writes,
      diagnostics,
    );
  }

  const configPath = join(configRootPath, "opencode.json");
  const configResult = await readJsonObject(configPath);
  const config =
    configResult.status === "ok"
      ? configResult.value
      : configResult.status === "missing"
        ? {}
        : undefined;

  if (configResult.status === "error") {
    diagnostics.push(configResult.diagnostic);
  }

  if (config === undefined) {
    return;
  }

  const existingMcp = objectField(config.mcp, configPath, diagnostics, "mcp");

  if (!existingMcp) {
    return;
  }

  for (const [name, value] of Object.entries(mcp)) {
    if (
      existingMcp[name] !== undefined &&
      JSON.stringify(existingMcp[name]) !== JSON.stringify(value)
    ) {
      diagnostics.push({
        code: "opencode-install-mcp-conflict",
        message: `Existing OpenCode MCP entry differs from generated packport MCP: ${name}.`,
        path: configPath,
        severity: "error",
      });
      continue;
    }

    existingMcp[name] = value;
  }

  config.$schema = OPENCODE_SCHEMA;
  config.mcp = sortRecord(existingMcp);

  if (materializeConfigport && (await hasInstructionSelections(rootPath, "opencode", "user"))) {
    const instructions = arrayField(config.instructions, configPath, diagnostics, "instructions");

    if (!instructions) {
      return;
    }

    const userInstructionPath = join(configRootPath, "AGENTS.md");

    if (!instructions.includes(userInstructionPath)) {
      instructions.push(userInstructionPath);
    }

    config.instructions = [...instructions].sort(compareStrings);
  }

  writes.push({
    content: `${JSON.stringify(sortRecord(config), null, 2)}\n`,
    description: "Install OpenCode config",
    kind: "write",
    path: configPath,
  });

  writes.push({
    content: `${JSON.stringify(
      {
        files: [...nextOwnedFiles].sort(compareStrings),
        rootPath,
        stateVersion: 1,
        target: "opencode",
      },
      null,
      2,
    )}\n`,
    description: "Record OpenCode install ownership",
    kind: "write",
    path: join(configRootPath, OPENCODE_INSTALL_STATE_FILE),
  });
}

async function planOpenCodeAssetCopies(
  packagePath: string,
  configRootPath: string,
  ownedFiles: ReadonlySet<string>,
  nextOwnedFiles: Set<string>,
  writes: PlannedWrite[],
  diagnostics: Diagnostic[],
): Promise<void> {
  await planOpenCodeDirectoryCopies(
    join(packagePath, ".opencode", "commands"),
    configRootPath,
    join(configRootPath, "commands"),
    ownedFiles,
    nextOwnedFiles,
    writes,
    diagnostics,
  );
  await planOpenCodeDirectoryCopies(
    join(packagePath, ".opencode", "agents"),
    configRootPath,
    join(configRootPath, "agents"),
    ownedFiles,
    nextOwnedFiles,
    writes,
    diagnostics,
  );
  await planOpenCodeDirectoryCopies(
    join(packagePath, ".opencode", "skills"),
    configRootPath,
    join(configRootPath, "skills"),
    ownedFiles,
    nextOwnedFiles,
    writes,
    diagnostics,
  );
}

async function planOpenCodeDirectoryCopies(
  sourceRootPath: string,
  configRootPath: string,
  targetRootPath: string,
  ownedFiles: ReadonlySet<string>,
  nextOwnedFiles: Set<string>,
  writes: PlannedWrite[],
  diagnostics: Diagnostic[],
): Promise<void> {
  if (!(await pathExists(sourceRootPath))) {
    return;
  }

  for (const sourcePath of await collectFiles(sourceRootPath)) {
    const relativePath = relative(sourceRootPath, sourcePath);
    const targetPath = join(targetRootPath, relativePath);
    const ownedPath = relativePathFrom(configRootPath, targetPath);
    const targetContent = await readOptionalBytes(targetPath, diagnostics);
    const sourceContent = await readFile(sourcePath);

    if (
      targetContent !== undefined &&
      !targetContent.equals(sourceContent) &&
      !ownedFiles.has(ownedPath)
    ) {
      diagnostics.push({
        code: "opencode-install-file-conflict",
        message: "Existing OpenCode file differs and is not owned by packport install.",
        path: targetPath,
        severity: "error",
      });
      continue;
    }

    nextOwnedFiles.add(ownedPath);
    writes.push({
      description: "Install OpenCode asset file",
      kind: "copy",
      path: targetPath,
      sourcePath,
    });
  }
}

async function materializeInstallInstructions(
  rootPath: string,
  target: InstallTarget,
  options: InstallPackRepositoryOptions,
): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(
    ...(await materializeInstructionScope(rootPath, target, "project", rootPath)),
    ...(await materializeInstructionScope(
      rootPath,
      target,
      "user",
      instructionHomePath(target, options),
    )),
  );

  return diagnostics;
}

async function materializeInstructionScope(
  rootPath: string,
  target: HarnessTarget,
  scope: "project" | "user",
  outputPath: string,
): Promise<readonly Diagnostic[]> {
  const stateRootPath = join(rootPath, ".configport");
  const stateResult = await readConfigportState(stateRootPath);
  const diagnostics: Diagnostic[] = [];

  if (stateResult.status === "error") {
    diagnostics.push(...stateResult.diagnostics);
  }

  if (hasErrorDiagnostics(diagnostics)) {
    return diagnostics;
  }

  const selections = stateResult.state.instructionSelections.filter(
    (selection) => selection.target === target && selection.scope === scope,
  );

  for (const selection of selections) {
    const result = await materializeConfigportInstructions({
      outputPath,
      pack: selection.pack,
      packRootPath: rootPath,
      profile: selection.profile,
      scope,
      stateRootPath,
      target,
    });

    diagnostics.push(...result.diagnostics);
  }

  return diagnostics;
}

async function dryRunInstructionSummaries(
  rootPath: string,
  target: InstallTarget,
  options: InstallPackRepositoryOptions,
): Promise<readonly string[]> {
  const summaries: string[] = [];
  const stateResult = await readConfigportState(join(rootPath, ".configport"));

  if (stateResult.status === "error") {
    return [];
  }

  const projectSelections = stateResult.state.instructionSelections.filter(
    (selection) => selection.target === target && selection.scope === "project",
  );
  const userSelections = stateResult.state.instructionSelections.filter(
    (selection) => selection.target === target && selection.scope === "user",
  );

  if (projectSelections.length > 0) {
    summaries.push(
      `Would materialize ${projectSelections.length} ${target} project instruction selection(s) to ${rootPath}.`,
    );
  }

  if (userSelections.length > 0) {
    summaries.push(
      `Would materialize ${userSelections.length} ${target} user instruction selection(s) to ${instructionHomePath(target, options)}.`,
    );
  }

  return summaries;
}

function instructionHomePath(target: InstallTarget, options: InstallPackRepositoryOptions): string {
  if (target === "claude") {
    return resolve(options.claudeHomePath ?? join(homedir(), ".claude"));
  }

  if (target === "opencode") {
    return resolve(
      options.opencodeConfigRootPath ??
        join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode"),
    );
  }

  return resolve(options.codexHomePath ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
}

async function hasInstructionSelections(
  rootPath: string,
  target: HarnessTarget,
  scope: "project" | "user",
): Promise<boolean> {
  const stateResult = await readConfigportState(join(rootPath, ".configport"));

  if (stateResult.status === "error") {
    return false;
  }

  return stateResult.state.instructionSelections.some(
    (selection) => selection.target === target && selection.scope === scope,
  );
}

function mergeCodexPluginBlock(
  existing: string,
  marketplaceName: string,
  pluginNames: readonly string[],
  path: string,
  diagnostics: Diagnostic[],
): string {
  let unmanagedConfig = removeManagedBlock(
    existing,
    CODEX_PLUGINS_BLOCK_START,
    CODEX_PLUGINS_BLOCK_END,
  );
  const chunks: string[] = [];

  for (const pluginName of [...pluginNames].sort(compareStrings)) {
    const key = `${pluginName}@${marketplaceName}`;
    const table = extractTomlTable(unmanagedConfig, "plugins", key);

    if (table !== undefined) {
      if (!isAdoptableEnabledPluginTable(table.content)) {
        diagnostics.push({
          code: "codex-install-plugin-conflict",
          message: `Existing Codex plugin config conflicts with generated plugin enablement: ${key}.`,
          path,
          severity: "error",
        });
        continue;
      }

      unmanagedConfig = `${unmanagedConfig.slice(0, table.start)}${unmanagedConfig.slice(table.end)}`;
    }

    chunks.push(`[plugins.${tomlKey(key)}]\nenabled = true`);
  }

  if (chunks.length === 0) {
    return unmanagedConfig;
  }

  return mergeManagedBlock(
    unmanagedConfig,
    CODEX_PLUGINS_BLOCK_START,
    CODEX_PLUGINS_BLOCK_END,
    chunks.join("\n\n"),
  );
}

function extractManagedBlock(
  content: string,
  startMarker: string,
  endMarker: string,
): string | undefined {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    return undefined;
  }

  return content.slice(start + startMarker.length, end).trim();
}

function extractTomlTable(
  content: string,
  namespace: string,
  name: string,
): { readonly content: string; readonly end: number; readonly start: number } | undefined {
  const lines = content.split(/(?<=\n)/);
  let offset = 0;
  const pattern = new RegExp(
    `^\\s*\\[${escapeRegExp(namespace)}\\.${tomlKeyPattern(name)}\\]\\s*$`,
  );

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const start = offset;
    offset += line.length;

    if (!pattern.test(line.trimEnd())) {
      continue;
    }

    let end = offset;

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex] ?? "";

      if (/^\s*\[/.test(nextLine)) {
        break;
      }

      end += nextLine.length;
    }

    return { content: content.slice(start, end), end, start };
  }

  return undefined;
}

function isAdoptableEnabledPluginTable(content: string): boolean {
  const meaningfulLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("["));

  return meaningfulLines.length === 1 && meaningfulLines[0] === "enabled = true";
}

async function readOpenCodeOwnedFiles(configRootPath: string): Promise<ReadonlySet<string>> {
  const stateResult = await readJsonObject(join(configRootPath, OPENCODE_INSTALL_STATE_FILE));
  const legacyResult = await readJsonObject(join(configRootPath, OPENCODE_LEGACY_STATE_FILE));
  const files = new Set<string>();

  if (stateResult.status === "ok" && Array.isArray(stateResult.value.files)) {
    for (const file of stateResult.value.files) {
      if (typeof file === "string") {
        files.add(file);
      }
    }
  }

  if (legacyResult.status === "ok" && isRecord(legacyResult.value.generated)) {
    addLegacyOpenCodeFiles(files, "commands", legacyResult.value.generated.commands);
    addLegacyOpenCodeFiles(files, "agents", legacyResult.value.generated.agents);
    addLegacyOpenCodeFiles(files, "skills", legacyResult.value.generated.skills);
  }

  return files;
}

function addLegacyOpenCodeFiles(files: Set<string>, directory: string, value: unknown): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const name of value) {
    if (typeof name !== "string" || name === "" || name.includes("/") || name.includes("\\")) {
      continue;
    }

    files.add(
      directory === "skills" ? join(directory, name, "SKILL.md") : join(directory, `${name}.md`),
    );
  }
}

async function readCodexMarketplace(
  path: string,
  diagnostics: Diagnostic[],
): Promise<CodexMarketplace | undefined> {
  const result = await readJsonObject(path);

  if (result.status === "error") {
    diagnostics.push(result.diagnostic);
    return undefined;
  }

  if (
    result.status !== "ok" ||
    typeof result.value.name !== "string" ||
    !Array.isArray(result.value.plugins)
  ) {
    diagnostics.push({
      code: "missing-codex-marketplace",
      message: "Generated Codex marketplace is missing or malformed.",
      path,
      severity: "error",
    });
    return undefined;
  }

  return {
    ...(isRecord(result.value.interface) ? { interface: result.value.interface } : {}),
    name: result.value.name,
    plugins: result.value.plugins.filter(isCodexMarketplaceEntry),
  };
}

async function readClaudeMarketplace(
  path: string,
  diagnostics: Diagnostic[],
): Promise<ClaudeMarketplace | undefined> {
  const result = await readJsonObject(path);

  if (result.status === "error") {
    diagnostics.push(result.diagnostic);
    return undefined;
  }

  if (
    result.status !== "ok" ||
    typeof result.value.name !== "string" ||
    !Array.isArray(result.value.plugins)
  ) {
    diagnostics.push({
      code: "missing-claude-marketplace",
      message: "Generated Claude marketplace is missing or malformed.",
      path,
      severity: "error",
    });
    return undefined;
  }

  return {
    name: result.value.name,
    plugins: result.value.plugins.filter(isClaudeMarketplaceEntry),
  };
}

async function readJsonObject(path: string): Promise<JsonReadResult> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));

    if (!isRecord(value)) {
      return {
        diagnostic: {
          code: "invalid-json-object",
          message: "JSON file must contain an object.",
          path,
          severity: "error",
        },
        status: "error",
      };
    }

    return { status: "ok", value };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: "missing" };
    }

    return {
      diagnostic: {
        code: "invalid-json",
        message: error instanceof Error ? error.message : "JSON file could not be read.",
        path,
        severity: "error",
      },
      status: "error",
    };
  }
}

async function readOptionalText(
  path: string,
  diagnostics: Diagnostic[],
): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return "";
    }

    diagnostics.push({
      code: "unreadable-install-file",
      message: error instanceof Error ? error.message : "Install target file could not be read.",
      path,
      severity: "error",
    });
    return undefined;
  }
}

async function readOptionalBytes(
  path: string,
  diagnostics: Diagnostic[],
): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }

    diagnostics.push({
      code: "unreadable-install-file",
      message: error instanceof Error ? error.message : "Install target file could not be read.",
      path,
      severity: "error",
    });
    return undefined;
  }
}

async function safeDirectoryNames(
  path: string,
  diagnostics: Diagnostic[],
): Promise<readonly string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareStrings);
  } catch (error) {
    if (isMissingPathError(error)) {
      diagnostics.push({
        code: "missing-generated-output",
        message: "Generated output required for install is missing.",
        path,
        severity: "error",
      });
      return [];
    }

    throw error;
  }
}

async function collectFiles(rootPath: string): Promise<readonly string[]> {
  const stats = await lstat(rootPath);

  if (stats.isFile()) {
    return [rootPath];
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(rootPath, entry.name);

      if (entry.isDirectory()) {
        return await collectFiles(path);
      }

      return entry.isFile() ? [path] : [];
    }),
  );

  return files.flat().sort(compareStrings);
}

async function validatePlannedWrites(
  writes: readonly PlannedWrite[],
  diagnostics: Diagnostic[],
  allowedSymlinkRootPaths: readonly string[],
): Promise<void> {
  const seen = new Map<string, PlannedWrite>();

  for (const write of writes) {
    const previous = seen.get(write.path);

    if (previous) {
      diagnostics.push({
        code: "install-target-collision",
        message: "Multiple install operations target the same path.",
        path: write.path,
        severity: "error",
      });
      continue;
    }

    seen.set(write.path, write);

    try {
      await assertPathDoesNotContainSymlinks(write.path, allowedSymlinkRootPaths);
    } catch (error) {
      diagnostics.push({
        code: "unsafe-install-path",
        message: error instanceof Error ? error.message : "Install path could not be validated.",
        path: write.path,
        severity: "error",
      });
    }
  }
}

async function applyPlannedWrite(write: PlannedWrite): Promise<void> {
  if (write.kind === "remove") {
    await rm(write.path, { force: true, recursive: true });
    return;
  }

  await mkdir(dirname(write.path), { recursive: true });

  if (write.kind === "copy") {
    await cp(write.sourcePath, write.path, { force: true, recursive: true });
    return;
  }

  await writeFile(write.path, write.content);
}

async function assertPathDoesNotContainSymlinks(
  path: string,
  allowedSymlinkRootPaths: readonly string[],
): Promise<void> {
  const absolutePath = resolve(path);
  const allowedRoots = allowedSymlinkRootPaths.map((rootPath) => resolve(rootPath));
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
        const symlinkTargetPath = await realpath(currentPath);

        if (allowedRoots.some((rootPath) => isSamePathOrInside(symlinkTargetPath, rootPath))) {
          currentPath = symlinkTargetPath;
          continue;
        }

        throw new Error(`Install path must not contain symlinks: ${currentPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }
  }
}

function isSamePathOrInside(path: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !parse(relativePath).root);
}

function objectField(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  field: string,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return {};
  }

  if (isRecord(value)) {
    return { ...value };
  }

  diagnostics.push({
    code: "invalid-install-config",
    message: `Existing config field must contain an object: ${field}.`,
    path,
    severity: "error",
  });
  return undefined;
}

function arrayField(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  field: string,
): string[] | undefined {
  if (value === undefined) {
    return [];
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return [...value];
  }

  diagnostics.push({
    code: "invalid-install-config",
    message: `Existing config field must contain a string list: ${field}.`,
    path,
    severity: "error",
  });
  return undefined;
}

function isCodexMarketplaceEntry(value: unknown): value is CodexMarketplaceEntry {
  return isRecord(value) && typeof value.name === "string";
}

function isClaudeMarketplaceEntry(value: unknown): value is ClaudeMarketplaceEntry {
  return isRecord(value) && typeof value.name === "string" && typeof value.source === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => compareStrings(left, right)),
  );
}

function hasErrorDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function tomlKey(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlKeyPattern(value: string): string {
  const bare = /^[A-Za-z0-9_-]+$/.test(value) ? escapeRegExp(value) : undefined;
  const doubleQuoted = `"${escapeRegExp(value).replace(/"/g, '\\"')}"`;
  const singleQuoted = `'${escapeRegExp(value).replace(/'/g, "''")}'`;
  return bare === undefined
    ? `(?:${doubleQuoted}|${singleQuoted})`
    : `(?:${bare}|${doubleQuoted}|${singleQuoted})`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

function relativePathFrom(rootPath: string, path: string): string {
  const relativePath = relative(rootPath, path);
  return relativePath.split(sep).join("/");
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
