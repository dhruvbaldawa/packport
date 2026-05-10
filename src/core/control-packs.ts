// ABOUTME: Defines built-in control pack identities shared by generators and packagers.
// ABOUTME: Keeps tool-owned control workflows separate from ordinary user pack generation.

import { join } from "node:path";

export const CONTROL_PACK_NAME = "packport-control";
export const CONTROL_PACK_DIRECTORY = join("packs", CONTROL_PACK_NAME);
export const CONFIGPORT_CONTROL_PACK_NAME = "configport-control";
export const CONFIGPORT_CONTROL_PACK_DIRECTORY = join("packs", CONFIGPORT_CONTROL_PACK_NAME);
export const CONTROL_PLUGIN_NAME = "packport";
export const CONFIGPORT_CONTROL_PLUGIN_NAME = "configport";

const BUILT_IN_CONTROL_PACK_NAMES = new Set([CONTROL_PACK_NAME, CONFIGPORT_CONTROL_PACK_NAME]);
const BUILT_IN_CONTROL_PLUGIN_PACKAGE_NAMES = new Set([
  CONTROL_PLUGIN_NAME,
  CONFIGPORT_CONTROL_PLUGIN_NAME,
]);

/** Returns true for tool-owned control packs that require explicit control packaging. */
export function isBuiltInControlPack(packId: string): boolean {
  return BUILT_IN_CONTROL_PACK_NAMES.has(packId);
}

/** Returns true for tool-owned generated control plugin package names. */
export function isBuiltInControlPluginPackage(packageName: string): boolean {
  return BUILT_IN_CONTROL_PLUGIN_PACKAGE_NAMES.has(packageName);
}
