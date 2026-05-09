// ABOUTME: Exposes minimal packport package metadata for the bootstrap commit.
// ABOUTME: Gives tests a stable import before feature modules are introduced.

export const packageName = "packport";

/** Describes the packport tool in one sentence for smoke tests and basic imports. */
export function describePackport(): string {
  return "packport portable agent-pack tooling";
}
