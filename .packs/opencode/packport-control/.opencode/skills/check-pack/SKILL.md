---
name: check-pack
description: "Validate a portable pack repository with packport. Use before committing, releasing, installing, or migrating pack source."
---

# Check Pack

## Purpose

Use this skill to run packport's deterministic validation primitive and explain the result without reimplementing validation logic in the skill.

## Workflow

1. Identify the pack repository root. Use the path the user gave; otherwise use the current workspace.
2. Run `packport check <root>`.
3. If working from the packport source tree before a binary is installed, run `bun src/cli.ts check <root>`.
4. Report errors first, then warnings. Include file paths exactly as reported.
5. For source drift, missing locked sources, or unlocked sources, explain that `pack.lock.yaml` no longer matches the current pack source.

## Boundaries

- Do not parse `PACK.md`, `ASSET.md`, payloads, or `pack.lock.yaml` yourself.
- Do not edit payload files unless the user asks for a repair.
- Do not treat warning-only output as failure.
- Do not regenerate target harness output from this skill.
