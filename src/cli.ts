// ABOUTME: Implements packport's minimal CLI wrapper around deterministic primitives.
// ABOUTME: Keeps interactive workflows in skills while preserving automation entrypoints.

import { join } from "node:path";
import {
  formatClaudeMigrationPlan,
  formatClaudeMigrationScan,
  planClaudeMigration,
  scanClaudeMigrationSource,
} from "./core/claude-migration";
import { checkPackRepository, formatDiagnostics } from "./core/check";
import { generateClaudeControlPlugin } from "./core/control-plugin";

const PACKAGE_VERSION = "0.0.0";
const CONTROL_SOURCE_ROOT = join(import.meta.dir, "..");
const USAGE =
  "Usage: packport check [root]\n       packport control-plugin claude <output> [source-root]\n       packport migrate-claude scan [root]\n       packport migrate-claude plan [root] [--exclude-plugin <name>]...";

type ParsedClaudeMigrationPlanArgs =
  | {
      readonly excludePlugins: readonly string[];
      readonly rootPath: string;
      readonly status: "ok";
    }
  | { readonly message: string; readonly status: "error" };

type CliResult = {
  readonly exitCode: number;
  readonly stderr?: string;
  readonly stdout?: string;
};

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
    const [harness, outputPath, rootPath = CONTROL_SOURCE_ROOT] = args;

    if (harness !== "claude" || outputPath === undefined) {
      return { exitCode: 1, stderr: USAGE };
    }

    const result = await generateClaudeControlPlugin(rootPath, outputPath, PACKAGE_VERSION);

    return {
      exitCode: 0,
      stdout: `Generated Claude control plugin at ${result.pluginPath} with ${result.skills.length} skill(s).`,
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
      const parsed = parseClaudeMigrationPlanArgs(args.slice(1));

      if (parsed.status === "error") {
        return { exitCode: 1, stderr: `${parsed.message}\n${USAGE}` };
      }

      const result = await planClaudeMigration(parsed.rootPath, {
        excludePlugins: parsed.excludePlugins,
      });
      const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");

      return {
        exitCode: ok ? 0 : 1,
        stdout: formatClaudeMigrationPlan(result),
      };
    }

    if (subcommand === undefined) {
      return { exitCode: 1, stderr: USAGE };
    }

    return { exitCode: 1, stderr: USAGE };
  }

  return {
    exitCode: 1,
    stderr: `Unknown command '${command ?? ""}'.\n${USAGE}`,
  };
}

/** Parses plan options that let skills apply user-approved migration decisions. */
function parseClaudeMigrationPlanArgs(args: readonly string[]): ParsedClaudeMigrationPlanArgs {
  const excludePlugins: string[] = [];
  let rootPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
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

    if (arg.startsWith("--")) {
      return { message: `Unknown migrate-claude plan option '${arg}'.`, status: "error" };
    }

    if (rootPath !== undefined) {
      return { message: "migrate-claude plan accepts at most one root path.", status: "error" };
    }

    rootPath = arg;
  }

  return { excludePlugins, rootPath: rootPath ?? process.cwd(), status: "ok" };
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
