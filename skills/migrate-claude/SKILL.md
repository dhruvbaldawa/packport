---
name: migrate-claude
description: Inspect a Claude Code marketplace or plugin and guide migration into portable pack source. Use before converting existing Claude assets.
---

# Migrate Claude

## Purpose

Use this skill to inspect Claude Code marketplace or plugin source before writing portable pack files. The scanner reports structure and migration candidates; the skill handles judgment and user questions.

## Workflow

1. Identify the Claude source path. Accept a marketplace repository root or a single plugin directory.
2. Run `packport migrate-claude scan <path>`.
3. If working from the packport source tree before a binary is installed, run `bun src/cli.ts migrate-claude scan <path>`.
4. Summarize discovered plugins and assets by kind.
5. Call out personal-overlay and harness-specific candidates as questions, not decisions.
6. Do not write portable pack source until the user confirms how unclear or personal content should be handled.

## Boundaries

- Do not infer migration state by parsing Claude payload prose yourself.
- Do not silently decide what is personal versus reusable when scanner signals are ambiguous.
- Do not generate target harness output from this skill.
- Do not edit the source Claude marketplace or plugin unless the user explicitly asks for a repair.
