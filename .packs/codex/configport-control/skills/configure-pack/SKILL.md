---
name: configure-pack
description: "Configure local values and overlays for one selected pack."
---

# Configure Pack

Use this skill when a pack needs local values, repeated personal substitutions, or target-specific overlay files before it can be applied.

## Workflow

1. Identify the profile, target harness, pack name, generated package path, and intended output scope.
2. Inspect the generated package for repeated local literals such as names, usernames, local paths, service endpoints, model preferences, or private project references.
3. Ask before turning a literal into an overlay replacement. If it is reusable behavior, suggest moving it into pack source instead.
4. Store accepted replacements with `packport configport overlay put <state-root> <profile> <target> <pack> --replace <from=to>`.
5. Store accepted local files with `--file <path=content>` only when they are local/profile-specific and not portable pack behavior.
6. For runtime instruction assets, select them with `packport configport instructions put <state-root> <profile> <target> <pack> <scope> --instruction <name> --answer <config.key=value>`.
7. Apply generated packages with `packport configport apply <state-root> <generated> <output> --profile <profile> --target <target> --pack <pack>`.
8. Materialize selected instructions with `packport configport instructions apply <state-root> <pack-root> <output> --profile <profile> --target <target> --pack <pack> --scope <scope>`.
9. Report which files changed and where configport state was written.

## Boundaries

- Do not edit pack source for local names, local paths, secrets, or selected-pack state.
- Do not put reusable instructions into overlays.
- Do not hand-edit generated output; use configport primitives.
