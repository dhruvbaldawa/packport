// ABOUTME: Provides the deterministic packport check primitive.
// ABOUTME: Converts discovery diagnostics into stable validation results and text output.

import { cp, lstat, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { generateClaudeOutput } from "./claude";
import { generateCodexOutput } from "./codex";
import {
  CONFIGPORT_CONTROL_PACK_NAME,
  CONFIGPORT_CONTROL_PLUGIN_NAME,
  CONTROL_PACK_NAME,
  CONTROL_PLUGIN_NAME,
} from "./control-packs";
import { materializeConfigportInstructions, readConfigportState } from "./configport";
import { generateClaudeControlMarketplace, generateClaudeControlPlugin } from "./control-plugin";
import { discoverPackRepository } from "./discovery";
import {
  detectLockDrift,
  PACK_LOCK_FILE,
  readPackLock,
  serializePackLock,
  type LockedOutput,
  type PackLock,
} from "./lockfile";
import { generateOpenCodeOutput } from "./opencode";
import type { Diagnostic, PackRepositoryIndex } from "./types";

const PACKPORT_TOOL_VERSION = "0.0.0";
const GENERATE_NO_CONFIGPORT_DECISION = "generate:no-configport";
const GENERATE_NO_CONFIGPORT_DECISION_PREFIX = `${GENERATE_NO_CONFIGPORT_DECISION}:`;
const TEMP_WORKSPACE_PATHS = [
  "packs",
  PACK_LOCK_FILE,
  ".packs",
  ".claude-plugin",
  ".agents",
  ".codex",
  ".configport",
  "AGENTS.md",
  "CLAUDE.md",
] as const;

export type CheckResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly index: PackRepositoryIndex;
  readonly lock?: PackLock;
  readonly ok: boolean;
};

/** Checks a pack repository and reports whether it has any error diagnostics. */
export async function checkPackRepository(rootPath: string): Promise<CheckResult> {
  const discovery = await discoverPackRepository(rootPath);
  const lockResult = await readPackLock(rootPath);
  const diagnostics = lockResult.lock
    ? [
        ...discovery.diagnostics,
        ...lockResult.diagnostics,
        ...(await detectLockDrift(rootPath, lockResult.lock, discovery.index)),
        ...(await detectGeneratedOutputDrift(rootPath, lockResult.lock)),
      ]
    : [...discovery.diagnostics, ...lockResult.diagnostics];
  const ok = !diagnostics.some((diagnostic) => diagnostic.severity === "error");

  return {
    ...(lockResult.lock ? { lock: lockResult.lock } : {}),
    diagnostics,
    index: discovery.index,
    ok,
  };
}

async function detectGeneratedOutputDrift(rootPath: string, lock: PackLock): Promise<Diagnostic[]> {
  if (lock.outputs.length === 0) {
    return [];
  }

  const tempParentPath = await mkdtemp(join(tmpdir(), "packport-generated-check-"));
  const tempRootPath = join(tempParentPath, "repo");

  try {
    await copyCheckWorkspace(rootPath, tempRootPath);
    const generationDiagnostics = remapTempDiagnostics(
      await replayLockedGeneration(tempRootPath, lock.outputs, lock.decisions),
      rootPath,
      tempRootPath,
    );
    const tempLockResult = await readPackLock(tempRootPath);
    const diagnostics = [
      ...generationDiagnostics,
      ...remapTempDiagnostics(tempLockResult.diagnostics, rootPath, tempRootPath),
    ];

    if (!tempLockResult.lock || diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return diagnostics;
    }

    diagnostics.push(
      ...(await compareGeneratedOutputs(rootPath, tempRootPath, tempLockResult.lock.outputs)),
    );
    diagnostics.push(
      ...(await compareConfigportInstructionOutputs(
        rootPath,
        tempRootPath,
        lock.outputs,
        lock.decisions,
      )),
    );

    if (serializePackLock(tempLockResult.lock) !== serializePackLock(lock)) {
      diagnostics.push({
        code: "generated-lock-drift",
        message: "pack.lock.yaml differs from the lockfile produced by current generators.",
        path: join(rootPath, PACK_LOCK_FILE),
        severity: "error",
      });
    }

    return diagnostics;
  } catch (error) {
    return [
      {
        code: "generated-output-check-failed",
        message:
          error instanceof Error
            ? error.message
            : "Generated output freshness check could not be completed.",
        path: rootPath,
        severity: "error",
      },
    ];
  } finally {
    await rm(tempParentPath, { force: true, recursive: true });
  }
}

async function copyCheckWorkspace(rootPath: string, tempRootPath: string): Promise<void> {
  await mkdir(tempRootPath, { recursive: true });

  for (const relativePath of TEMP_WORKSPACE_PATHS) {
    const sourcePath = join(rootPath, relativePath);

    if (!(await pathExists(sourcePath))) {
      continue;
    }

    const targetPath = join(tempRootPath, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { force: true, recursive: true });
  }
}

async function replayLockedGeneration(
  tempRootPath: string,
  outputs: readonly LockedOutput[],
  decisions: readonly string[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  if (hasClaudeUserGeneration(outputs)) {
    diagnostics.push(
      ...(
        await generateClaudeOutput(tempRootPath, undefined, {
          includeControlPacks: hasPackage(outputs, "claude", [
            CONFIGPORT_CONTROL_PACK_NAME,
            CONTROL_PACK_NAME,
          ]),
        })
      ).diagnostics,
    );
  }

  if (hasTarget(outputs, "opencode")) {
    diagnostics.push(
      ...(
        await generateOpenCodeOutput(tempRootPath, join(tempRootPath, ".packs", "opencode"), {
          includeControlPacks: hasPackage(outputs, "opencode", [
            CONFIGPORT_CONTROL_PACK_NAME,
            CONTROL_PACK_NAME,
          ]),
        })
      ).diagnostics,
    );
  }

  if (hasTarget(outputs, "codex")) {
    diagnostics.push(
      ...(
        await generateCodexOutput(tempRootPath, undefined, {
          includeControlPacks: hasPackage(outputs, "codex", [
            CONFIGPORT_CONTROL_PACK_NAME,
            CONTROL_PACK_NAME,
          ]),
        })
      ).diagnostics,
    );
  }

  if (hasPackage(outputs, "claude", [CONTROL_PLUGIN_NAME])) {
    await generateClaudeControlPlugin(
      tempRootPath,
      join(tempRootPath, ".packs", "claude", CONTROL_PLUGIN_NAME),
      PACKPORT_TOOL_VERSION,
      "packport",
    );
  }

  if (hasPackage(outputs, "claude", [CONFIGPORT_CONTROL_PLUGIN_NAME])) {
    await generateClaudeControlPlugin(
      tempRootPath,
      join(tempRootPath, ".packs", "claude", CONFIGPORT_CONTROL_PLUGIN_NAME),
      PACKPORT_TOOL_VERSION,
      "configport",
    );
  }

  if (
    hasTargetKind(outputs, "claude", "marketplace") &&
    hasPackage(outputs, "claude", [CONFIGPORT_CONTROL_PLUGIN_NAME, CONTROL_PLUGIN_NAME])
  ) {
    await generateClaudeControlMarketplace(tempRootPath);
  }

  diagnostics.push(
    ...(await replayConfigportInstructionMaterialization(tempRootPath, outputs, decisions)),
  );

  return diagnostics;
}

async function replayConfigportInstructionMaterialization(
  tempRootPath: string,
  outputs: readonly LockedOutput[],
  decisions: readonly string[],
): Promise<Diagnostic[]> {
  const stateRootPath = join(tempRootPath, ".configport");
  const stateResult = await readConfigportState(stateRootPath);
  const diagnostics: Diagnostic[] = [];
  const targetSet = configportEnabledTargets(outputs, decisions);

  if (stateResult.status === "error") {
    diagnostics.push(...stateResult.diagnostics);
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return diagnostics;
  }

  for (const selection of stateResult.state.instructionSelections.filter((selection) =>
    targetSet.has(selection.target),
  )) {
    const result = await materializeConfigportInstructions({
      outputPath: tempRootPath,
      pack: selection.pack,
      packRootPath: tempRootPath,
      profile: selection.profile,
      scope: selection.scope,
      stateRootPath,
      target: selection.target,
    });

    diagnostics.push(...result.diagnostics);
  }

  return diagnostics;
}

async function compareGeneratedOutputs(
  rootPath: string,
  tempRootPath: string,
  outputs: readonly LockedOutput[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const output of outputs) {
    const expectedPath = join(tempRootPath, output.path);
    const currentPath = join(rootPath, output.path);
    const expected = await readOptionalFile(expectedPath);
    const current = await readOptionalFile(currentPath);

    if (expected === undefined) {
      continue;
    }

    if (current === undefined) {
      diagnostics.push({
        code: "generated-output-drift",
        message: "Generated output expected by current generators is missing.",
        path: currentPath,
        severity: "error",
      });
      continue;
    }

    if (!current.equals(expected)) {
      diagnostics.push({
        code: "generated-output-drift",
        message: "Generated output differs from current generator output.",
        path: currentPath,
        severity: "error",
      });
    }
  }

  return diagnostics;
}

async function compareConfigportInstructionOutputs(
  rootPath: string,
  tempRootPath: string,
  outputs: readonly LockedOutput[],
  decisions: readonly string[],
): Promise<Diagnostic[]> {
  const stateResult = await readConfigportState(join(rootPath, ".configport"));

  if (stateResult.status === "error") {
    return [];
  }

  const targetSet = configportEnabledTargets(outputs, decisions);
  const outputPaths = new Set(
    stateResult.state.instructionSelections
      .filter((selection) => targetSet.has(selection.target))
      .map((selection) => (selection.target === "claude" ? "CLAUDE.md" : "AGENTS.md")),
  );
  const diagnostics: Diagnostic[] = [];

  for (const outputPath of outputPaths) {
    const expectedPath = join(tempRootPath, outputPath);
    const currentPath = join(rootPath, outputPath);
    const expected = await readOptionalFile(expectedPath);
    const current = await readOptionalFile(currentPath);

    if (expected === undefined) {
      continue;
    }

    if (current === undefined) {
      diagnostics.push({
        code: "configport-instruction-drift",
        message: "Configport instruction output expected by current selections is missing.",
        path: currentPath,
        severity: "error",
      });
      continue;
    }

    if (!current.equals(expected)) {
      diagnostics.push({
        code: "configport-instruction-drift",
        message: "Configport instruction output differs from current configport selections.",
        path: currentPath,
        severity: "error",
      });
    }
  }

  return diagnostics;
}

function configportEnabledTargets(
  outputs: readonly LockedOutput[],
  decisions: readonly string[],
): Set<string> {
  if (decisions.includes(GENERATE_NO_CONFIGPORT_DECISION)) {
    return new Set();
  }

  return new Set(
    outputs
      .map((output) => output.target)
      .filter(
        (target) => !decisions.includes(`${GENERATE_NO_CONFIGPORT_DECISION_PREFIX}${target}`),
      ),
  );
}

async function readOptionalFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }

    throw error;
  }
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

function hasTarget(outputs: readonly LockedOutput[], target: string): boolean {
  return outputs.some((output) => output.target === target);
}

function hasClaudeUserGeneration(outputs: readonly LockedOutput[]): boolean {
  return outputs.some(
    (output) =>
      output.target === "claude" &&
      ((output.kind === "package" && !isClaudeControlPackage(output.packageName)) ||
        (output.kind === "marketplace" &&
          !hasPackage(outputs, "claude", [CONFIGPORT_CONTROL_PLUGIN_NAME, CONTROL_PLUGIN_NAME]))),
  );
}

function isClaudeControlPackage(packageName: string | undefined): boolean {
  return packageName === CONFIGPORT_CONTROL_PLUGIN_NAME || packageName === CONTROL_PLUGIN_NAME;
}

function hasTargetKind(
  outputs: readonly LockedOutput[],
  target: string,
  kind: LockedOutput["kind"],
): boolean {
  return outputs.some((output) => output.target === target && output.kind === kind);
}

function hasPackage(
  outputs: readonly LockedOutput[],
  target: string,
  packageNames: readonly string[],
): boolean {
  const packages = new Set(packageNames);

  return outputs.some(
    (output) =>
      output.target === target &&
      output.kind === "package" &&
      output.packageName !== undefined &&
      packages.has(output.packageName),
  );
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function remapTempDiagnostics(
  diagnostics: readonly Diagnostic[],
  rootPath: string,
  tempRootPath: string,
): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    path: remapTempPath(diagnostic.path, rootPath, tempRootPath),
  }));
}

function remapTempPath(path: string, rootPath: string, tempRootPath: string): string {
  const relativePath = relative(tempRootPath, path);

  if (relativePath === "" || isOutsideRelativePath(relativePath)) {
    return path;
  }

  return join(rootPath, relativePath);
}

function isOutsideRelativePath(value: string): boolean {
  return value === ".." || value.startsWith(`..${sep}`) || value.startsWith("../");
}

/** Formats check diagnostics for CLI output in a stable, grep-friendly form. */
export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "No packport issues found.";
  }

  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`,
    )
    .join("\n");
}
