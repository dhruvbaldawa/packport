---
name: add-harness
description: "Add or extend a packport harness target adapter. Use when implementing support for a new agent harness or expanding Claude Code, OpenCode, or Codex target behavior."
---

# Add Harness

## Purpose

Use this skill to add harness support through deterministic resolver, emitter, validator, reference, and configport boundaries without changing unrelated payload files.

## Workflow

1. Identify the harness target id, supported native surfaces, config paths, marketplace or plugin format, and install scopes.
2. Read the existing target implementation closest to the new harness before designing new abstractions.
3. Add or update harness references for tool names, MCP aliases, permissions, model roles, config paths, and known unsupported behavior.
4. Implement discovery-to-plan mapping in a target resolver or existing generator layer, keeping payload files opaque except for explicit portable refs or target-native syntax transforms.
5. Implement emitter writes for stable native files only. Keep configport install, overlay, and local-answer materialization out of packport generation.
6. Add target validation for names, paths, collisions, marketplace sources, stale generated output, and unsafe symlinks.
7. Add focused tests for generation, stale cleanup, lockfile ownership, marketplace preservation when applicable, and unsupported assets.
8. Regenerate dogfood output if the harness is part of packport's supported targets, then run `packport check <root>` and the repository quality gate.

## Boundaries

- Do not edit existing payload files just to add a harness.
- Do not put target-specific accepted degradation into payloads; record or report it through resolver decisions and lockfile state.
- Do not add a broad schema before repeated usage proves the prose-first contract is insufficient.
