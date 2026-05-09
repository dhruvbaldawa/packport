// ABOUTME: Provides the deterministic packport check primitive.
// ABOUTME: Converts discovery diagnostics into stable validation results and text output.

import { discoverPackRepository } from "./discovery";
import type { Diagnostic, PackRepositoryIndex } from "./types";

export type CheckResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly index: PackRepositoryIndex;
  readonly ok: boolean;
};

/** Checks a pack repository and reports whether it has any error diagnostics. */
export async function checkPackRepository(rootPath: string): Promise<CheckResult> {
  const discovery = await discoverPackRepository(rootPath);
  const ok = !discovery.diagnostics.some((diagnostic) => diagnostic.severity === "error");

  return { diagnostics: discovery.diagnostics, index: discovery.index, ok };
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
