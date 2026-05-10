// ABOUTME: Exposes minimal packport package metadata for the bootstrap commit.
// ABOUTME: Gives tests a stable import before feature modules are introduced.

export const packageName = "packport";
export const packageVersion = "0.0.0";

export {
  formatClaudeMigrationPlan,
  formatClaudeMigrationScan,
  planClaudeMigration,
  scanClaudeMigrationSource,
  writeClaudeMigration,
} from "./core/claude-migration";
export { checkPackRepository, formatDiagnostics } from "./core/check";
export {
  CONTROL_PLUGIN_NAME,
  CONTROL_SKILLS_DIRECTORY,
  discoverControlSkills,
  generateClaudeControlPlugin,
} from "./core/control-plugin";
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
export { generateOpenCodeOutput } from "./core/opencode";
export { runCli } from "./cli";
export type {
  ClaudeMigrationAsset,
  ClaudeMigrationAssetKind,
  ClaudeMigrationClassification,
  ClaudeMigrationFact,
  ClaudeMigrationFactKind,
  ClaudeMigrationPlanFile,
  ClaudeMigrationPlanOptions,
  ClaudeMigrationPlanQuestion,
  ClaudeMigrationPlanResult,
  ClaudeMigrationPlugin,
  ClaudeMigrationScanResult,
  ClaudeMigrationWriteResult,
} from "./core/claude-migration";
export type { CheckResult } from "./core/check";
export type { ControlSkill, GenerateControlPluginResult } from "./core/control-plugin";
export type { LockedAsset, LockedPack, LockedSource, PackLock } from "./core/lockfile";
export type { GenerateOpenCodeResult } from "./core/opencode";
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
