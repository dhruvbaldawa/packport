# packport User Guide

packport keeps agent capability source in readable `packs/` directories and generates
harness-native packages under `.packs/`. configport then keeps local values, profile choices, and
machine-specific overlays outside reusable pack source.

That split is the project:

- `packs/` is the canonical source authors and agents edit.
- `.packs/<target>/` is generated, commit-worthy target output.
- native marketplace files point Claude Code and Codex at generated local packages.
- `configport.json` stores local overlay state for a profile, target, and pack.
- skills are the preferred interactive UX; CLI commands are deterministic primitives that skills call.

## Read This First

Use the narrowest guide that matches your immediate job:

- [Quick Start](quick-start.md): validate this repo, regenerate dogfood output, and try the control
  packs.
- [Concepts](concepts.md): understand the packport/configport split and the source/generated/local
  boundaries.
- [Authoring Packs](authoring-packs.md): create or edit source packs under `packs/`.
- [Generating Targets](generating-targets.md): emit OpenCode, Codex, Claude control packages, and
  marketplaces.
- [Migrating From Claude Code](migrating-from-claude.md): scan, plan, and write portable source
  from an existing Claude marketplace or plugin.
- [Configuring With configport](configuring-with-configport.md): apply local replacements and
  files without editing generated output.
- [Dogfooding](dogfooding.md): use packport on itself and on a real Claude-first pack repository.
- [CLI Reference](cli-reference.md): look up command syntax and output behavior.

## Current Scope

The current code supports a useful bootstrap path:

- validate portable pack source with `check`.
- migrate Claude Code plugin source into portable pack source with `migrate-claude`.
- generate OpenCode repo-local output from portable packs.
- generate Codex plugins and `.agents/plugins/marketplace.json` from portable packs.
- generate Claude Code control plugins for the built-in `packport` and `configport` skills.
- generate a Claude Code control marketplace at `.claude-plugin/marketplace.json`.
- store and apply configport overlays for generated output.

The current Claude Code generator is for control plugins. Arbitrary user-pack generation for Claude
Code is still design work. The migration primitive can write portable source from Claude plugins,
but target generation from that source should currently use the OpenCode and Codex emitters unless
you are generating the built-in Claude control packages.

## Operating Rule

Edit source packs and local overlay state. Regenerate target packages. Do not hand-maintain
generated output unless a migration step intentionally creates initial source files for review.
