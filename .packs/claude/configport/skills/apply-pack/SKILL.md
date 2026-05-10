---
name: apply-pack
description: Apply one generated pack output through configport profile overlays.
---

# Apply Pack

Use this skill when a generated pack package should be materialized into a profile or target-tool output location.

## Workflow

1. Confirm the state root, profile, target, pack, generated package path, instruction pack root when needed, scope, and output path.
2. Run `packport configport check <state-root> <generated> <output> --profile <profile> --target <target> --pack <pack>` when output already exists and drift should be reviewed before overwrite.
3. Run `packport configport apply <state-root> <generated> <output> --profile <profile> --target <target> --pack <pack>`.
4. Run `packport configport check <state-root> <generated> <output> --profile <profile> --target <target> --pack <pack>` again to confirm materialized output matches the selected overlay.
5. When runtime instructions are selected, run `packport configport instructions apply <state-root> <pack-root> <output> --profile <profile> --target <target> --pack <pack> --scope <scope>`.
6. If configport reports unsafe symlinks, missing generated output, missing materialized output, output drift, missing instructions, unresolved refs, path collisions, or invalid state, stop and report the exact diagnostic.
7. Do not edit the materialized output by hand; update configport overlays, instruction selections, local answers, or pack source and apply again.
