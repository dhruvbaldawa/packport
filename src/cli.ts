// ABOUTME: Implements packport's minimal CLI wrapper around deterministic primitives.
// ABOUTME: Keeps interactive workflows in skills while preserving automation entrypoints.

import { join } from "node:path";
import { formatClaudeDiagnostics, generateClaudeOutput } from "./core/claude";
import {
  formatClaudeMigrationPlan,
  formatClaudeMigrationScan,
  planClaudeMigration,
  scanClaudeMigrationSource,
  writeClaudeMigration,
} from "./core/claude-migration";
import { checkPackRepository, formatDiagnostics } from "./core/check";
import { generateCodexOutput, formatCodexDiagnostics } from "./core/codex";
import {
  applyConfigportOverlay,
  checkConfigportOverlay,
  formatConfigportDiagnostics,
  materializeConfigportInstructions,
  writeConfigportInstructionSelection,
  writeConfigportOverlay,
  type ConfigportFileOverlay,
  type ConfigportInstructionScope,
  type ConfigportInstructionSelection,
  type ConfigportOverlay,
  type ConfigportReplacement,
} from "./core/configport";
import {
  generateClaudeControlMarketplace,
  generateClaudeControlPlugin,
  type ControlPluginKind,
} from "./core/control-plugin";
import type { HarnessTarget } from "./core/harness-refs";
import { generateOpenCodeOutput } from "./core/opencode";

const PACKAGE_VERSION = "0.0.0";
const CONTROL_SOURCE_ROOT = join(import.meta.dir, "..");
const USAGE =
  "Usage: packport check [root]\n       packport control-plugin claude <output> [source-root]\n       packport control-plugin claude configport <output> [source-root]\n       packport control-plugin claude-marketplace <repo-root> [package-root]\n       packport migrate-claude scan [root]\n       packport migrate-claude plan [root] [--accept-asset <plugin/name>]... [--exclude-plugin <name>]... [--exclude-asset <plugin/name>]...\n       packport migrate-claude write <source> <output> [--accept-asset <plugin/name>]... [--exclude-plugin <name>]... [--exclude-asset <plugin/name>]...";
const CLAUDE_USAGE = "Usage: packport claude generate <pack-root> [output-root]";
const OPENCODE_USAGE =
  "Usage: packport opencode generate <pack-root> <output-root> [--include-control-packs]";
const CODEX_USAGE =
  "Usage: packport codex generate <pack-root> [output-root] [--include-control-packs]";
const CONFIGPORT_USAGE =
  "Usage: packport configport overlay put <state-root> <profile> <target> <pack> [--replace <from=to>]... [--file <path=content>]...\n       packport configport apply <state-root> <generated> <output> --profile <profile> --target <target> --pack <pack>\n       packport configport check <state-root> <generated> <output> --profile <profile> --target <target> --pack <pack>\n       packport configport instructions put <state-root> <profile> <target> <pack> <scope> --instruction <name>... [--answer <key=value>]...\n       packport configport instructions apply <state-root> <pack-root> <output> --profile <profile> --target <target> --pack <pack> --scope <scope>";

type ParsedClaudeMigrationArgs =
  | {
      readonly acceptAssets: readonly string[];
      readonly excludeAssets: readonly string[];
      readonly excludePlugins: readonly string[];
      readonly paths: readonly string[];
      readonly status: "ok";
    }
  | { readonly message: string; readonly status: "error" };

type ParsedConfigportOverlayPutArgs =
  | {
      readonly overlay: ConfigportOverlay;
      readonly stateRootPath: string;
      readonly status: "ok";
    }
  | { readonly message: string; readonly status: "error" };

type ParsedConfigportApplyArgs =
  | {
      readonly generatedPath: string;
      readonly outputPath: string;
      readonly pack: string;
      readonly profile: string;
      readonly stateRootPath: string;
      readonly status: "ok";
      readonly target: string;
    }
  | { readonly message: string; readonly status: "error" };

type ParsedConfigportInstructionsPutArgs =
  | {
      readonly selection: ConfigportInstructionSelection;
      readonly stateRootPath: string;
      readonly status: "ok";
    }
  | { readonly message: string; readonly status: "error" };

type ParsedConfigportInstructionsApplyArgs =
  | {
      readonly outputPath: string;
      readonly pack: string;
      readonly packRootPath: string;
      readonly profile: string;
      readonly scope: ConfigportInstructionScope;
      readonly stateRootPath: string;
      readonly status: "ok";
      readonly target: HarnessTarget;
    }
  | { readonly message: string; readonly status: "error" };

type CliResult = {
  readonly exitCode: number;
  readonly stderr?: string;
  readonly stdout?: string;
};

type ParsedGenerateArgs =
  | {
      readonly includeControlPacks: boolean;
      readonly outputPath?: string;
      readonly rootPath: string;
      readonly status: "ok";
    }
  | { readonly status: "error" };

/** Runs the packport CLI with explicit argv for tests and the process argv for production. */
export async function runCli(argv: readonly string[]): Promise<CliResult> {
  const [command, ...args] = argv;

  if (command === "check") {
    const [rootPath = process.cwd()] = args;
    const result = await checkPackRepository(rootPath);
    return {
      exitCode: result.ok ? 0 : 1,
      stdout: formatDiagnostics(result.diagnostics),
    };
  }

  if (command === "control-plugin") {
    const [harness, firstArg, secondArg, thirdArg] = args;

    if (harness === "claude-marketplace") {
      if (firstArg === undefined || args.length > 3) {
        return { exitCode: 1, stderr: USAGE };
      }

      const result = await generateClaudeControlMarketplace(firstArg, secondArg);

      return {
        exitCode: 0,
        stdout: `Generated Claude control marketplace at ${result.marketplacePath} with ${result.entries.length} plugin(s).`,
      };
    }

    if (harness !== "claude" || firstArg === undefined) {
      return { exitCode: 1, stderr: USAGE };
    }

    const pluginKind: ControlPluginKind = firstArg === "configport" ? "configport" : "packport";
    const outputPath = firstArg === "configport" ? secondArg : firstArg;
    const rootPath =
      firstArg === "configport"
        ? (thirdArg ?? CONTROL_SOURCE_ROOT)
        : (secondArg ?? CONTROL_SOURCE_ROOT);

    if (outputPath === undefined) {
      return { exitCode: 1, stderr: USAGE };
    }

    const result = await generateClaudeControlPlugin(
      rootPath,
      outputPath,
      PACKAGE_VERSION,
      pluginKind,
    );
    const label = pluginKind === "packport" ? "control plugin" : `${pluginKind} control plugin`;

    return {
      exitCode: 0,
      stdout: `Generated Claude ${label} at ${result.pluginPath} with ${result.skills.length} skill(s).`,
    };
  }

  if (command === "migrate-claude") {
    const [subcommand, rootPath = process.cwd()] = args;

    if (subcommand === "scan") {
      const result = await scanClaudeMigrationSource(rootPath);
      const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");

      return {
        exitCode: ok ? 0 : 1,
        stdout: formatClaudeMigrationScan(result),
      };
    }

    if (subcommand === "plan") {
      const parsed = parseClaudeMigrationArgs(args.slice(1));

      if (parsed.status === "error") {
        return { exitCode: 1, stderr: `${parsed.message}\n${USAGE}` };
      }

      if (parsed.paths.length > 1) {
        return {
          exitCode: 1,
          stderr: `migrate-claude plan accepts at most one root path.\n${USAGE}`,
        };
      }

      const result = await planClaudeMigration(parsed.paths[0] ?? process.cwd(), {
        acceptAssets: parsed.acceptAssets,
        excludeAssets: parsed.excludeAssets,
        excludePlugins: parsed.excludePlugins,
      });
      const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");

      return {
        exitCode: ok ? 0 : 1,
        stdout: formatClaudeMigrationPlan(result),
      };
    }

    if (subcommand === "write") {
      const parsed = parseClaudeMigrationArgs(args.slice(1));

      if (parsed.status === "error") {
        return { exitCode: 1, stderr: `${parsed.message}\n${USAGE}` };
      }

      if (parsed.paths.length !== 2) {
        return {
          exitCode: 1,
          stderr: `migrate-claude write requires source and output paths.\n${USAGE}`,
        };
      }

      const [rootPath, outputPath] = parsed.paths;

      if (rootPath === undefined || outputPath === undefined) {
        return {
          exitCode: 1,
          stderr: `migrate-claude write requires source and output paths.\n${USAGE}`,
        };
      }

      const result = await writeClaudeMigration(rootPath, outputPath, {
        acceptAssets: parsed.acceptAssets,
        excludeAssets: parsed.excludeAssets,
        excludePlugins: parsed.excludePlugins,
      });
      const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
      const diagnostics = result.diagnostics
        .map(
          (diagnostic) =>
            `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`,
        )
        .join("\n");
      const summary = `Wrote ${result.summary.files} Claude migration file(s) to ${result.outputPath}.`;

      return {
        exitCode: ok ? 0 : 1,
        stdout: diagnostics ? `${summary}\n${diagnostics}` : summary,
      };
    }

    if (subcommand === undefined) {
      return { exitCode: 1, stderr: USAGE };
    }

    return { exitCode: 1, stderr: USAGE };
  }

  if (command === "claude") {
    const [subcommand, rootPath, outputPath] = args;

    if (subcommand !== "generate" || rootPath === undefined) {
      return { exitCode: 1, stderr: CLAUDE_USAGE };
    }

    if (args.length > 3) {
      return { exitCode: 1, stderr: CLAUDE_USAGE };
    }

    const result = await generateClaudeOutput(rootPath, outputPath);
    const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    const diagnostics = formatClaudeDiagnostics(result.diagnostics);
    const summary = `Generated Claude output at ${result.outputPath} with ${result.summary.plugins} plugin(s), ${result.summary.commands} command(s), ${result.summary.agents} agent(s), ${result.summary.skills} skill(s), and ${result.summary.marketplaceEntries} marketplace entry(s).`;

    return {
      exitCode: ok ? 0 : 1,
      stdout: result.diagnostics.length > 0 ? `${summary}\n${diagnostics}` : summary,
    };
  }

  if (command === "opencode") {
    const parsed = parseGenerateArgs(args, { outputRequired: true });

    if (parsed.status === "error" || parsed.outputPath === undefined) {
      return { exitCode: 1, stderr: OPENCODE_USAGE };
    }

    const result = await generateOpenCodeOutput(parsed.rootPath, parsed.outputPath, {
      includeControlPacks: parsed.includeControlPacks,
    });
    const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    const diagnostics = result.diagnostics
      .map(
        (diagnostic) =>
          `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`,
      )
      .join("\n");
    const summary = `Generated OpenCode output at ${result.outputPath} with ${result.summary.packages} package(s), ${result.summary.commands} command(s), ${result.summary.agents} agent(s), and ${result.summary.skills} skill(s).`;

    return {
      exitCode: ok ? 0 : 1,
      stdout: diagnostics ? `${summary}\n${diagnostics}` : summary,
    };
  }

  if (command === "codex") {
    const parsed = parseGenerateArgs(args, { outputRequired: false });

    if (parsed.status === "error") {
      return { exitCode: 1, stderr: CODEX_USAGE };
    }

    const result = await generateCodexOutput(parsed.rootPath, parsed.outputPath, {
      includeControlPacks: parsed.includeControlPacks,
    });
    const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    const diagnostics = formatCodexDiagnostics(result.diagnostics);
    const summary = `Generated Codex output at ${result.outputPath} with ${result.summary.plugins} plugin(s), ${result.summary.skills} skill(s), ${result.summary.agents} agent(s), and ${result.summary.marketplaceEntries} marketplace entry(s).`;

    return {
      exitCode: ok ? 0 : 1,
      stdout: result.diagnostics.length > 0 ? `${summary}\n${diagnostics}` : summary,
    };
  }

  if (command === "configport") {
    return await runConfigportCli(args);
  }

  return {
    exitCode: 1,
    stderr: `Unknown command '${command ?? ""}'.\n${USAGE}\n${CLAUDE_USAGE}\n${OPENCODE_USAGE}\n${CODEX_USAGE}\n${CONFIGPORT_USAGE}`,
  };
}

async function runConfigportCli(args: readonly string[]): Promise<CliResult> {
  const [subcommand, action] = args;

  if (subcommand === "overlay" && action === "put") {
    const parsed = parseConfigportOverlayPutArgs(args.slice(2));

    if (parsed.status === "error") {
      return { exitCode: 1, stderr: `${parsed.message}\n${CONFIGPORT_USAGE}` };
    }

    const result = await writeConfigportOverlay(parsed.stateRootPath, parsed.overlay);
    const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    const diagnostics = formatConfigportDiagnostics(result.diagnostics);
    const summary = `Stored configport overlay ${parsed.overlay.profile}/${parsed.overlay.target}/${parsed.overlay.pack} at ${result.statePath} with ${result.summary.replacements} replacement(s) and ${result.summary.files} file overlay(s).`;

    return {
      exitCode: ok ? 0 : 1,
      stdout: result.diagnostics.length > 0 ? diagnostics : summary,
    };
  }

  if (subcommand === "apply") {
    const parsed = parseConfigportApplyArgs(args.slice(1), "apply");

    if (parsed.status === "error") {
      return { exitCode: 1, stderr: `${parsed.message}\n${CONFIGPORT_USAGE}` };
    }

    const result = await applyConfigportOverlay(parsed);
    const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    const diagnostics = formatConfigportDiagnostics(result.diagnostics);
    const summary = `Applied configport overlay ${parsed.profile}/${parsed.target}/${parsed.pack} to ${result.outputPath} with ${result.summary.files} file(s).`;

    return {
      exitCode: ok ? 0 : 1,
      stdout: result.diagnostics.length > 0 ? diagnostics : summary,
    };
  }

  if (subcommand === "check") {
    const parsed = parseConfigportApplyArgs(args.slice(1), "check");

    if (parsed.status === "error") {
      return { exitCode: 1, stderr: `${parsed.message}\n${CONFIGPORT_USAGE}` };
    }

    const result = await checkConfigportOverlay(parsed);
    const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    const diagnostics = formatConfigportDiagnostics(result.diagnostics);
    const summary = `Checked configport overlay ${parsed.profile}/${parsed.target}/${parsed.pack} at ${result.outputPath} with ${result.summary.files} file(s).`;

    return {
      exitCode: ok ? 0 : 1,
      stdout: result.diagnostics.length > 0 ? `${summary}\n${diagnostics}` : summary,
    };
  }

  if (subcommand === "instructions" && action === "put") {
    const parsed = parseConfigportInstructionsPutArgs(args.slice(2));

    if (parsed.status === "error") {
      return { exitCode: 1, stderr: `${parsed.message}\n${CONFIGPORT_USAGE}` };
    }

    const result = await writeConfigportInstructionSelection(
      parsed.stateRootPath,
      parsed.selection,
    );
    const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    const diagnostics = formatConfigportDiagnostics(result.diagnostics);
    const summary = `Stored configport instruction selection ${parsed.selection.profile}/${parsed.selection.target}/${parsed.selection.pack}/${parsed.selection.scope} at ${result.statePath} with ${result.summary.instructions} instruction(s) and ${result.summary.answers} answer(s).`;

    return {
      exitCode: ok ? 0 : 1,
      stdout: result.diagnostics.length > 0 ? diagnostics : summary,
    };
  }

  if (subcommand === "instructions" && action === "apply") {
    const parsed = parseConfigportInstructionsApplyArgs(args.slice(2));

    if (parsed.status === "error") {
      return { exitCode: 1, stderr: `${parsed.message}\n${CONFIGPORT_USAGE}` };
    }

    const result = await materializeConfigportInstructions(parsed);
    const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    const diagnostics = formatConfigportDiagnostics(result.diagnostics);
    const summary = `Materialized configport instructions ${parsed.profile}/${parsed.target}/${parsed.pack}/${parsed.scope} to ${result.outputPath} with ${result.summary.files} file(s).`;

    return {
      exitCode: ok ? 0 : 1,
      stdout: result.diagnostics.length > 0 ? diagnostics : summary,
    };
  }

  return { exitCode: 1, stderr: CONFIGPORT_USAGE };
}

function parseGenerateArgs(
  args: readonly string[],
  options: { readonly outputRequired: boolean },
): ParsedGenerateArgs {
  const [subcommand, ...rest] = args;

  if (subcommand !== "generate") {
    return { status: "error" };
  }

  const paths: string[] = [];
  let includeControlPacks = false;

  for (const arg of rest) {
    if (arg === "--include-control-packs") {
      includeControlPacks = true;
      continue;
    }

    if (arg.startsWith("--")) {
      return { status: "error" };
    }

    paths.push(arg);
  }

  if (paths.length < 1 || paths.length > 2) {
    return { status: "error" };
  }

  if (options.outputRequired && paths.length !== 2) {
    return { status: "error" };
  }

  const [rootPath, outputPath] = paths;

  if (rootPath === undefined || (options.outputRequired && outputPath === undefined)) {
    return { status: "error" };
  }

  return {
    includeControlPacks,
    ...(outputPath ? { outputPath } : {}),
    rootPath,
    status: "ok",
  };
}

function parseConfigportOverlayPutArgs(args: readonly string[]): ParsedConfigportOverlayPutArgs {
  const files: ConfigportFileOverlay[] = [];
  const replacements: ConfigportReplacement[] = [];
  const paths: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "--replace") {
      const value = args[index + 1];

      if (value === undefined || value === "" || value.startsWith("--")) {
        return { message: "--replace requires from=to.", status: "error" };
      }

      const replacement = parseAssignment(value, "--replace");

      if (replacement.status === "error") {
        return replacement;
      }

      replacements.push({ from: replacement.left, to: replacement.right });
      index += 1;
      continue;
    }

    if (arg.startsWith("--replace=")) {
      const replacement = parseAssignment(arg.slice("--replace=".length), "--replace");

      if (replacement.status === "error") {
        return replacement;
      }

      replacements.push({ from: replacement.left, to: replacement.right });
      continue;
    }

    if (arg === "--file") {
      const value = args[index + 1];

      if (value === undefined || value === "" || value.startsWith("--")) {
        return { message: "--file requires path=content.", status: "error" };
      }

      const file = parseAssignment(value, "--file");

      if (file.status === "error") {
        return file;
      }

      files.push({ content: file.right, path: file.left });
      index += 1;
      continue;
    }

    if (arg.startsWith("--file=")) {
      const file = parseAssignment(arg.slice("--file=".length), "--file");

      if (file.status === "error") {
        return file;
      }

      files.push({ content: file.right, path: file.left });
      continue;
    }

    if (arg.startsWith("--")) {
      return { message: `Unknown configport overlay option '${arg}'.`, status: "error" };
    }

    paths.push(arg);
  }

  if (paths.length !== 4) {
    return {
      message: "configport overlay put requires state-root, profile, target, and pack.",
      status: "error",
    };
  }

  const [stateRootPath, profile, target, pack] = paths;

  if (
    stateRootPath === undefined ||
    profile === undefined ||
    target === undefined ||
    pack === undefined
  ) {
    return {
      message: "configport overlay put requires state-root, profile, target, and pack.",
      status: "error",
    };
  }

  return {
    overlay: { files, pack, profile, replacements, target },
    stateRootPath,
    status: "ok",
  };
}

function parseConfigportApplyArgs(
  args: readonly string[],
  operation: "apply" | "check",
): ParsedConfigportApplyArgs {
  const paths: string[] = [];
  let pack: string | undefined;
  let profile: string | undefined;
  let target: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "--profile" || arg === "--target" || arg === "--pack") {
      const value = args[index + 1];

      if (value === undefined || value === "" || value.startsWith("--")) {
        return { message: `${arg} requires a value.`, status: "error" };
      }

      if (arg === "--profile") {
        profile = value;
      } else if (arg === "--target") {
        target = value;
      } else {
        pack = value;
      }

      index += 1;
      continue;
    }

    if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length);
      continue;
    }

    if (arg.startsWith("--target=")) {
      target = arg.slice("--target=".length);
      continue;
    }

    if (arg.startsWith("--pack=")) {
      pack = arg.slice("--pack=".length);
      continue;
    }

    if (arg.startsWith("--")) {
      return { message: `Unknown configport ${operation} option '${arg}'.`, status: "error" };
    }

    paths.push(arg);
  }

  if (paths.length !== 3) {
    return {
      message: `configport ${operation} requires state-root, generated, and output paths.`,
      status: "error",
    };
  }

  if (!profile || !target || !pack) {
    return {
      message: `configport ${operation} requires --profile, --target, and --pack.`,
      status: "error",
    };
  }

  const [stateRootPath, generatedPath, outputPath] = paths;

  if (stateRootPath === undefined || generatedPath === undefined || outputPath === undefined) {
    return {
      message: `configport ${operation} requires state-root, generated, and output paths.`,
      status: "error",
    };
  }

  return {
    generatedPath,
    outputPath,
    pack,
    profile,
    stateRootPath,
    status: "ok",
    target,
  };
}

function parseConfigportInstructionsPutArgs(
  args: readonly string[],
): ParsedConfigportInstructionsPutArgs {
  const answers: Record<string, string> = {};
  const instructions: string[] = [];
  const paths: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "--instruction") {
      const value = args[index + 1];

      if (value === undefined || value === "" || value.startsWith("--")) {
        return { message: "--instruction requires an instruction name.", status: "error" };
      }

      instructions.push(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--instruction=")) {
      const value = arg.slice("--instruction=".length);

      if (value === "") {
        return { message: "--instruction requires an instruction name.", status: "error" };
      }

      instructions.push(value);
      continue;
    }

    if (arg === "--answer") {
      const value = args[index + 1];

      if (value === undefined || value === "" || value.startsWith("--")) {
        return { message: "--answer requires key=value.", status: "error" };
      }

      const answer = parseAssignment(value, "--answer");

      if (answer.status === "error") {
        return answer;
      }

      answers[answer.left] = answer.right;
      index += 1;
      continue;
    }

    if (arg.startsWith("--answer=")) {
      const answer = parseAssignment(arg.slice("--answer=".length), "--answer");

      if (answer.status === "error") {
        return answer;
      }

      answers[answer.left] = answer.right;
      continue;
    }

    if (arg.startsWith("--")) {
      return { message: `Unknown configport instructions put option '${arg}'.`, status: "error" };
    }

    paths.push(arg);
  }

  if (paths.length !== 5) {
    return {
      message: "configport instructions put requires state-root, profile, target, pack, and scope.",
      status: "error",
    };
  }

  const [stateRootPath, profile, targetValue, pack, scopeValue] = paths;
  const target = parseHarnessTarget(targetValue);
  const scope = parseInstructionScope(scopeValue);

  if (targetValue !== undefined && target === undefined) {
    return {
      message: "configport instructions put target must be claude, codex, or opencode.",
      status: "error",
    };
  }

  if (scopeValue !== undefined && scope === undefined) {
    return {
      message: "configport instructions put scope must be project or user.",
      status: "error",
    };
  }

  if (
    stateRootPath === undefined ||
    profile === undefined ||
    pack === undefined ||
    target === undefined ||
    scope === undefined
  ) {
    return {
      message: "configport instructions put requires state-root, profile, target, pack, and scope.",
      status: "error",
    };
  }

  return {
    selection: { answers, instructions, pack, profile, scope, target },
    stateRootPath,
    status: "ok",
  };
}

function parseConfigportInstructionsApplyArgs(
  args: readonly string[],
): ParsedConfigportInstructionsApplyArgs {
  const paths: string[] = [];
  let pack: string | undefined;
  let profile: string | undefined;
  let scope: ConfigportInstructionScope | undefined;
  let target: HarnessTarget | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "--profile" || arg === "--target" || arg === "--pack" || arg === "--scope") {
      const value = args[index + 1];

      if (value === undefined || value === "" || value.startsWith("--")) {
        return { message: `${arg} requires a value.`, status: "error" };
      }

      if (arg === "--profile") {
        profile = value;
      } else if (arg === "--target") {
        target = parseHarnessTarget(value);

        if (target === undefined) {
          return {
            message: "configport instructions apply target must be claude, codex, or opencode.",
            status: "error",
          };
        }
      } else if (arg === "--scope") {
        scope = parseInstructionScope(value);

        if (scope === undefined) {
          return {
            message: "configport instructions apply scope must be project or user.",
            status: "error",
          };
        }
      } else {
        pack = value;
      }

      index += 1;
      continue;
    }

    if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length);
      continue;
    }

    if (arg.startsWith("--target=")) {
      const value = arg.slice("--target=".length);
      target = parseHarnessTarget(value);

      if (target === undefined) {
        return {
          message: "configport instructions apply target must be claude, codex, or opencode.",
          status: "error",
        };
      }
      continue;
    }

    if (arg.startsWith("--pack=")) {
      pack = arg.slice("--pack=".length);
      continue;
    }

    if (arg.startsWith("--scope=")) {
      const value = arg.slice("--scope=".length);
      scope = parseInstructionScope(value);

      if (scope === undefined) {
        return {
          message: "configport instructions apply scope must be project or user.",
          status: "error",
        };
      }
      continue;
    }

    if (arg.startsWith("--")) {
      return {
        message: `Unknown configport instructions apply option '${arg}'.`,
        status: "error",
      };
    }

    paths.push(arg);
  }

  if (paths.length !== 3) {
    return {
      message: "configport instructions apply requires state-root, pack-root, and output paths.",
      status: "error",
    };
  }

  if (!profile || !target || !pack || !scope) {
    return {
      message: "configport instructions apply requires --profile, --target, --pack, and --scope.",
      status: "error",
    };
  }

  const [stateRootPath, packRootPath, outputPath] = paths;

  if (stateRootPath === undefined || packRootPath === undefined || outputPath === undefined) {
    return {
      message: "configport instructions apply requires state-root, pack-root, and output paths.",
      status: "error",
    };
  }

  return {
    outputPath,
    pack,
    packRootPath,
    profile,
    scope,
    stateRootPath,
    status: "ok",
    target,
  };
}

function parseHarnessTarget(value: string | undefined): HarnessTarget | undefined {
  return value === "claude" || value === "codex" || value === "opencode" ? value : undefined;
}

function parseInstructionScope(value: string | undefined): ConfigportInstructionScope | undefined {
  return value === "project" || value === "user" ? value : undefined;
}

type ParsedAssignment =
  | { readonly left: string; readonly right: string; readonly status: "ok" }
  | { readonly message: string; readonly status: "error" };

function parseAssignment(value: string, optionName: string): ParsedAssignment {
  const separatorIndex = value.indexOf("=");

  if (separatorIndex <= 0) {
    return { message: `${optionName} requires name=value.`, status: "error" };
  }

  return {
    left: value.slice(0, separatorIndex),
    right: value.slice(separatorIndex + 1),
    status: "ok",
  };
}

/** Parses migration options that let skills apply user-approved decisions. */
function parseClaudeMigrationArgs(args: readonly string[]): ParsedClaudeMigrationArgs {
  const acceptAssets: string[] = [];
  const excludeAssets: string[] = [];
  const excludePlugins: string[] = [];
  const paths: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "--accept-asset") {
      const assetName = args[index + 1];

      if (assetName === undefined || assetName === "" || assetName.startsWith("--")) {
        return { message: "--accept-asset requires an asset key.", status: "error" };
      }

      acceptAssets.push(assetName);
      index += 1;
      continue;
    }

    if (arg.startsWith("--accept-asset=")) {
      const assetName = arg.slice("--accept-asset=".length);

      if (assetName === "") {
        return { message: "--accept-asset requires an asset key.", status: "error" };
      }

      acceptAssets.push(assetName);
      continue;
    }

    if (arg === "--exclude-plugin") {
      const pluginName = args[index + 1];

      if (pluginName === undefined || pluginName === "" || pluginName.startsWith("--")) {
        return { message: "--exclude-plugin requires a plugin name.", status: "error" };
      }

      excludePlugins.push(pluginName);
      index += 1;
      continue;
    }

    if (arg.startsWith("--exclude-plugin=")) {
      const pluginName = arg.slice("--exclude-plugin=".length);

      if (pluginName === "") {
        return { message: "--exclude-plugin requires a plugin name.", status: "error" };
      }

      excludePlugins.push(pluginName);
      continue;
    }

    if (arg === "--exclude-asset") {
      const assetName = args[index + 1];

      if (assetName === undefined || assetName === "" || assetName.startsWith("--")) {
        return { message: "--exclude-asset requires an asset key.", status: "error" };
      }

      excludeAssets.push(assetName);
      index += 1;
      continue;
    }

    if (arg.startsWith("--exclude-asset=")) {
      const assetName = arg.slice("--exclude-asset=".length);

      if (assetName === "") {
        return { message: "--exclude-asset requires an asset key.", status: "error" };
      }

      excludeAssets.push(assetName);
      continue;
    }

    if (arg.startsWith("--")) {
      return { message: `Unknown migrate-claude option '${arg}'.`, status: "error" };
    }

    paths.push(arg);
  }

  return { acceptAssets, excludeAssets, excludePlugins, paths, status: "ok" };
}

if (import.meta.main) {
  const result = await runCli(Bun.argv.slice(2));

  if (result.stdout) {
    console.log(result.stdout);
  }

  if (result.stderr) {
    console.error(result.stderr);
  }

  process.exit(result.exitCode);
}
