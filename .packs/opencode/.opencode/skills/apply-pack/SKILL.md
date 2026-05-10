---
name: apply-pack
description: "Apply one generated pack output through configport profile overlays."
---

# Apply Pack

Use this skill when a generated pack package should be materialized into a profile or target-tool output location.

## Workflow

1. Confirm the state root, profile, target, pack, generated package path, instruction pack root when needed, scope, and output path.
2. Run `packport configport apply <state-root> <generated> <output> --profile <profile> --target <target> --pack <pack>`.
3. When runtime instructions are selected, run `packport configport instructions apply <state-root> <pack-root> <output> --profile <profile> --target <target> --pack <pack> --scope <scope>`.
4. If configport reports unsafe symlinks, missing generated output, missing instructions, unresolved refs, path collisions, or invalid state, stop and report the exact diagnostic.
5. Do not edit the materialized output by hand; update configport overlays, instruction selections, local answers, or pack source and apply again.
