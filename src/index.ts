// ABOUTME: Exposes minimal packport package metadata for the bootstrap commit.
// ABOUTME: Gives tests a stable import before feature modules are introduced.

export const packageName = "packport";

export { checkPackRepository, formatDiagnostics } from "./core/check";
export { discoverPackRepository } from "./core/discovery";
export {
  createPackLock,
  detectLockDrift,
  PACK_LOCK_FILE,
  readPackLock,
  serializePackLock,
  writePackLock,
} from "./core/lockfile";
export { parseMarkdownContract } from "./core/markdown";
export { runCli } from "./cli";
export type { CheckResult } from "./core/check";
export type { LockedAsset, LockedPack, LockedSource, PackLock } from "./core/lockfile";
export type {
  AssetContract,
  AssetIndex,
  AssetKind,
  ContractKind,
  Diagnostic,
  DiscoveryResult,
  MarkdownDocument,
  MarkdownSection,
  PackIndex,
  PackRepositoryIndex,
} from "./core/types";

/** Describes the packport tool in one sentence for smoke tests and basic imports. */
export function describePackport(): string {
  return "packport portable agent-pack tooling";
}
