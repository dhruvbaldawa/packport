// ABOUTME: Exposes minimal packport package metadata for the bootstrap commit.
// ABOUTME: Gives tests a stable import before feature modules are introduced.

export const packageName = "packport";
export const packageVersion = "0.0.0";

export {
  CLAUDE_DEFAULT_OUTPUT_DIRECTORY,
  CLAUDE_MARKETPLACE_FILE,
  formatClaudeDiagnostics,
  generateClaudeOutput,
} from "./core/claude";
export {
  formatClaudeMigrationPlan,
  formatClaudeMigrationScan,
  planClaudeMigration,
  scanClaudeMigrationSource,
  writeClaudeMigration,
} from "./core/claude-migration";
export { checkPackRepository, formatDiagnostics } from "./core/check";
export {
  applyConfigportOverlay,
  CONFIGPORT_STATE_FILE,
  formatConfigportDiagnostics,
  materializeConfigportInstructions,
  readConfigportState,
  writeConfigportInstructionSelection,
  writeConfigportOverlay,
} from "./core/configport";
export {
  CODEX_DEFAULT_OUTPUT_DIRECTORY,
  CODEX_MARKETPLACE_FILE,
  formatCodexDiagnostics,
  generateCodexOutput,
} from "./core/codex";
export { isBuiltInControlPack, isBuiltInControlPluginPackage } from "./core/control-packs";
export {
  CONFIGPORT_CONTROL_PACK_DIRECTORY,
  CONFIGPORT_CONTROL_PACK_NAME,
  CONFIGPORT_CONTROL_PLUGIN_NAME,
  CONTROL_PLUGIN_NAME,
  CONTROL_PACK_DIRECTORY,
  CONTROL_PACK_NAME,
  CONTROL_SKILLS_DIRECTORY,
  CLAUDE_CONTROL_MARKETPLACE_FILE,
  discoverControlSkills,
  generateClaudeControlMarketplace,
  generateClaudeControlPlugin,
} from "./core/control-plugin";
export { discoverPackRepository } from "./core/discovery";
export {
  KNOWN_PORTABLE_MCP_REFS,
  KNOWN_PORTABLE_TOOL_REFS,
  renderPortableRefsForTarget,
  validateKnownPortableRefs,
} from "./core/harness-refs";
export {
  createPackLock,
  detectLockDrift,
  PACK_LOCK_FILE,
  readPackLock,
  serializePackLock,
  writePackGenerationPackageLock,
  writePackGenerationSelectionLock,
  writePackLock,
} from "./core/lockfile";
export { parseMarkdownContract } from "./core/markdown";
export { generateOpenCodeOutput } from "./core/opencode";
export { runCli } from "./cli";
export type { GenerateClaudeOptions, GenerateClaudeResult } from "./core/claude";
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
export type { GenerateCodexOptions, GenerateCodexResult } from "./core/codex";
export type {
  ApplyConfigportOverlayOptions,
  ApplyConfigportOverlayResult,
  ConfigportFileOverlay,
  ConfigportInstructionScope,
  ConfigportInstructionSelection,
  ConfigportOverlay,
  ConfigportOverlaySelector,
  ConfigportReplacement,
  ConfigportState,
  WriteConfigportOverlayResult,
  MaterializeConfigportInstructionsOptions,
  MaterializeConfigportInstructionsResult,
  WriteConfigportInstructionSelectionResult,
} from "./core/configport";
export type {
  ClaudeControlMarketplaceEntry,
  ControlPluginKind,
  ControlSkill,
  GenerateClaudeControlMarketplaceResult,
  GenerateControlPluginResult,
} from "./core/control-plugin";
export type { HarnessTarget, PortableRefRenderResult } from "./core/harness-refs";
export type { LockedAsset, LockedPack, LockedSource, PackLock } from "./core/lockfile";
export type { GenerateOpenCodeOptions, GenerateOpenCodeResult } from "./core/opencode";
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
