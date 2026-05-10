---
name: apply-pack
description: Apply one generated pack output through configport profile overlays.
---

# Apply Pack

Use this skill when a generated pack package should be materialized into a profile or target-tool output location.

## Workflow

1. Confirm the state root, profile, target, pack, generated package path, and output path.
2. Run `packport configport apply <state-root> <generated> <output> --profile <profile> --target <target> --pack <pack>`.
3. If configport reports unsafe symlinks, missing generated output, path collisions, or invalid state, stop and report the exact diagnostic.
4. Do not edit the materialized output by hand; update configport overlays or pack source and apply again.
