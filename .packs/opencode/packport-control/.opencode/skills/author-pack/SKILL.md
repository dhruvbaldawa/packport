---
name: author-pack
description: "Create or extend portable pack source using packport conventions. Use when a user wants a new pack, asset, skill, command, agent, instruction, or packaging contract."
---

# Author Pack

## Purpose

Use this skill to author readable portable source under `packs/` while keeping generated target output and local configuration out of pack source.

## Workflow

1. Identify the repository root, pack id, asset kind, asset name, and intended payload behavior.
2. Prefer convention paths: `PACK.md`, `skills/<name>/SKILL.md`, `commands/<name>/COMMAND.md`, `agents/<name>/AGENT.md`, `instructions/<name>/INSTRUCTION.md`, or `hooks/<name>/HOOK.md`.
3. Create `PACK.md` with only `name`, `version`, and `description` frontmatter when the pack is new.
4. Write payload content in the payload file. Keep packport metadata out of payloads.
5. Add `ASSET.md` only for non-obvious payload paths, declared portable refs, dependencies, needs, configuration, or source constraints.
6. For reusable values, use explicit `config`, `tool`, or `mcp` portable refs and declare each concrete ref in `PACK.md` or `ASSET.md`.
7. Run `packport check <root>`. If working from the packport source tree before a binary is installed, run `bun src/cli.ts check <root>`.
8. Report the created or changed source files and any check diagnostics.

## Boundaries

- Do not edit `.packs/`, native marketplace files, or `pack.lock.yaml` by hand.
- Do not put local names, local paths, usernames, secrets, selected-pack state, or install scope choices into reusable pack source.
- Do not add `ASSET.md` when directory conventions are enough.
