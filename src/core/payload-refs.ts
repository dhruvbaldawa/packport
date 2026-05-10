// ABOUTME: Renders portable refs in generated target payloads.
// ABOUTME: Keeps emitted package files free of unresolved packport syntax.

import { resolve } from "node:path";
import { renderPortableRefsForTarget, type HarnessTarget } from "./harness-refs";
import type { AssetIndex, Diagnostic } from "./types";

/** Returns whether a source path is one of the asset payloads that discovery scanned for refs. */
export function isAssetPayloadPath(asset: AssetIndex, path: string): boolean {
  const resolvedPath = resolve(path);

  return asset.payloadPaths.some((payloadPath) => resolve(payloadPath) === resolvedPath);
}

/** Renders refs declared for one payload file, blocking generation when config values are missing. */
export function renderAssetPayloadRefs(
  asset: AssetIndex,
  payloadPath: string,
  text: string,
  target: HarnessTarget,
  diagnostics: Diagnostic[],
): string | undefined {
  const result = renderPortableRefsForTarget(
    text,
    asset.payloadRefs.filter((ref) => ref.path === payloadPath),
    target,
  );

  diagnostics.push(...result.diagnostics);

  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return undefined;
  }

  return result.text;
}
