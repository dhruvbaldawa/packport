// ABOUTME: Implements packport's minimal CLI wrapper around deterministic primitives.
// ABOUTME: Keeps interactive workflows in skills while preserving automation entrypoints.

import { checkPackRepository, formatDiagnostics } from "./core/check";

type CliResult = {
  readonly exitCode: number;
  readonly stderr?: string;
  readonly stdout?: string;
};

/** Runs the packport CLI with explicit argv for tests and the process argv for production. */
export async function runCli(argv: readonly string[]): Promise<CliResult> {
  const [command, rootPath = process.cwd()] = argv;

  if (command === "check") {
    const result = await checkPackRepository(rootPath);
    return {
      exitCode: result.ok ? 0 : 1,
      stdout: formatDiagnostics(result.diagnostics),
    };
  }

  return {
    exitCode: 1,
    stderr: `Unknown command '${command ?? ""}'.\nUsage: packport check [root]`,
  };
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
