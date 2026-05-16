---
name: generate-pack
description: "Regenerate harness-native pack output and marketplaces from portable source. Use after source edits, before dogfooding, release preparation, or drift checks."
---

# Generate Pack

## Purpose

Use this skill to run packport generation primitives in the right order without hand-editing generated output.

## Workflow

1. Identify the pack repository root and target set: Claude Code, OpenCode, Codex, or all.
2. Run `packport check <root>` before generation. Stop on errors.
3. Run `packport generate <root>` for all targets, or add repeatable `--target claude`, `--target opencode`, and `--target codex` flags for a subset.
4. Use `--no-configport` only when the user explicitly wants to skip configured instruction materialization.
5. In the packport repository only, refresh Claude control plugins before aggregate generation with `packport control-plugin claude .packs/claude/packport`, `packport control-plugin claude configport .packs/claude/configport`, and `packport control-plugin claude-marketplace .`.
6. To wire generated output into tool-global configuration, run `packport install <root> --dry-run`, review the planned writes, then run `packport install <root>`.
7. If working from the packport source tree before a binary is installed, use `bun src/cli.ts` in place of `packport`.
8. Run `packport check <root>` again and report changed generated paths and diagnostics.

## Boundaries

- Do not edit generated files to fix generation results; edit source packs or configport state and regenerate.
- Do not materialize profile-local answers into committed `.packs/` output.
