---
name: configure-tools
description: "Configure selected packs, profiles, scopes, and target-tool overlays."
---

# Configure Tools

Use this skill to set up a profile or target harness scope that consumes generated pack output.

## Workflow

1. Determine the target harness, profile, install scope, generated package root, and materialized output path.
2. List selected packs and confirm which are profile-specific.
3. Use `configure-pack` for pack-local replacements and overlay files.
4. Apply each selected pack with `packport configport apply`.
5. Keep configport state outside reusable pack source and generated `.packs/` output.
6. Preserve unmanaged target-tool configuration unless configport owns the specific file path.

## Boundaries

- Do not merge every local value into a global registry; keep values scoped to the smallest pack/profile/target that needs them.
- Do not duplicate generated Claude-compatible and native OpenCode output in one target scope.
