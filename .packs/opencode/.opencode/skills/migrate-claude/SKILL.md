---
name: migrate-claude
description: "Inspect a Claude Code marketplace or plugin and guide migration into portable pack source. Use before converting existing Claude assets."
---

# Migrate Claude

## Purpose

Use this skill to inspect Claude Code marketplace or plugin source before writing portable pack files. The scanner reports structure and migration candidates; the skill handles judgment and user questions.

## Workflow

1. Identify the Claude source path. Accept a marketplace repository root or a single plugin directory.
2. Run `packport migrate-claude scan <path>`.
3. Run `packport migrate-claude plan <path>` to preview the portable file layout without writing source.
4. If working from the packport source tree before a binary is installed, use `bun src/cli.ts migrate-claude scan <path>` and `bun src/cli.ts migrate-claude plan <path>`.
5. Summarize discovered plugins, planned files, target collisions, structural facts, and decision questions.
6. Treat `pack-candidate` assets as normal pack source candidates, including personal or private packs.
7. Treat known structural facts such as explicit config/security variable references, `config-path-reference`, and `script-reference` as evidence to reason from, not as automatic classifications.
8. Inspect planned skill support-file questions as content findings, not just path findings; support files with local values may need configport treatment.
9. Expect multi-file skills to produce `ASSET.md` with `SKILL.md` first and support files after it.
10. Call out `harness-specific`, `unsupported`, `unclear`, and fact-bearing assets as questions, not decisions.
11. If the user marks a whole plugin as harness-specific, rerun the plan with `--exclude-plugin <name>` before summarizing portable source files.
12. If the user marks one asset as harness-specific, rerun the plan with `--exclude-asset <plugin/name>` before summarizing portable source files.
13. Do not write portable pack source until the user confirms pack boundaries and source-versus-configuration placement.
14. After every question is resolved or excluded, run `packport migrate-claude write <source> <output>` with the accepted exclusions.

## Boundaries

- Do not infer migration state by parsing Claude payload prose yourself; use the scanner's known structural facts.
- Do not split personal packs into a separate category; personal packs are still packs.
- Do not silently decide source-versus-configuration placement when scanner signals are ambiguous.
- Do not generate target harness output from this skill.
- Do not edit the source Claude marketplace or plugin unless the user explicitly asks for a repair.
