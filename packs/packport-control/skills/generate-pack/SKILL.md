---
name: generate-pack
description: Regenerate harness-native pack output and marketplaces from portable source. Use after source edits, before dogfooding, release preparation, or drift checks.
---

# Generate Pack

## Purpose

Use this skill to run packport generation primitives in the right order without hand-editing generated output.

## Workflow

1. Identify the pack repository root and target set: Claude Code, OpenCode, Codex, or all.
2. Run `packport check <root>` before generation. Stop on errors.
3. For Claude Code user packs, run `packport claude generate <root>`.
4. For OpenCode user packs, run `packport opencode generate <root> <root>/.packs/opencode`.
5. For Codex user packs, run `packport codex generate <root>`.
6. In the packport repository only, include control packs for dogfood output with `--include-control-packs` on OpenCode and Codex generation.
7. In the packport repository only, refresh Claude control plugins with `packport control-plugin claude .packs/claude/packport`, `packport control-plugin claude configport .packs/claude/configport`, and `packport control-plugin claude-marketplace .`.
8. If working from the packport source tree before a binary is installed, use `bun src/cli.ts` in place of `packport`.
9. Run `packport check <root>` again and report changed generated paths and diagnostics.

## Boundaries

- Do not use `--include-control-packs` in ordinary pack repositories unless the user explicitly asks for tool-owned control output.
- Do not edit generated files to fix generation results; edit source packs or configport state and regenerate.
- Do not materialize profile-local answers into committed `.packs/` output.
