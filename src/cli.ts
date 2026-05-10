// ABOUTME: Implements packport's minimal CLI wrapper around deterministic primitives.
// ABOUTME: Keeps interactive workflows in skills while preserving automation entrypoints.

import { join } from "node:path";
import {
  formatClaudeMigrationPlan,
  formatClaudeMigrationScan,
  planClaudeMigration,
  scanClaudeMigrationSource,
  writeClaudeMigration,
} from "./core/claude-migration";
import { checkPackRepository, formatDiagnostics } from "./core/check";
import { generateClaudeControlPlugin } from "./core/control-plugin";
import { generateOpenCodeOutput } from "./core/opencode";

const PACKAGE_VERSION = "0.0.0";
const CONTROL_SOURCE_ROOT = join(import.meta.dir, "..");
const USAGE =
  "Usage: packport check [root]\n       packport control-plugin claude <output> [source-root]\n       packport migrate-claude scan [root]\n       packport migrate-claude plan [root] [--exclude-plugin <name>]... [--exclude-asset <plugin/name>]...\n       packport migrate-claude write <source> <output> [--exclude-plugin <name>]... [--exclude-asset <plugin/name>]...";
const OPENCODE_USAGE = "Usage: packport opencode generate <pack-root> <output-root>";

type ParsedClaudeMigrationArgs =
  | {
      readonly excludeAssets: readonly string[];
      readonly excludePlugins: readonly string[];
      readonly paths: readonly string[];
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

  if (command === "opencode") {
    const [subcommand, rootPath, outputPath] = args;

    if (subcommand !== "generate" || rootPath === undefined || outputPath === undefined) {
      return { exitCode: 1, stderr: OPENCODE_USAGE };
    }

    if (args.length > 3) {
      return { exitCode: 1, stderr: OPENCODE_USAGE };
    }

    const result = await generateOpenCodeOutput(rootPath, outputPath);
    const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    const diagnostics = result.diagnostics
      .map(
        (diagnostic) =>
          `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`,
      )
      .join("\n");
    const summary = `Generated OpenCode output at ${result.outputPath} with ${result.summary.commands} command(s), ${result.summary.agents} agent(s), and ${result.summary.skills} skill(s).`;

    return {
      exitCode: ok ? 0 : 1,
      stdout: diagnostics ? `${summary}\n${diagnostics}` : summary,
    };
  }

  return {
    exitCode: 1,
    stderr: `Unknown command '${command ?? ""}'.\n${USAGE}\n${OPENCODE_USAGE}`,
  };
}

/** Parses migration options that let skills apply user-approved decisions. */
function parseClaudeMigrationArgs(args: readonly string[]): ParsedClaudeMigrationArgs {
  const excludeAssets: string[] = [];
  const excludePlugins: string[] = [];
  const paths: string[] = [];

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

  return { excludeAssets, excludePlugins, paths, status: "ok" };
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
