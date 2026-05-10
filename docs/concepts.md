# Concepts

packport is a portable source and generation tool. configport is the local configuration and overlay
tool. The harness agent is the interactive shell, and skills are the executable workflows that call
deterministic primitives.

## The Boundary

Use this rule first:

- reusable behavior belongs in pack source.
- generated harness packages belong in `.packs/`.
- local values belong in configport state.
- installed or materialized target-tool files are outputs.

That keeps public packs, private packs, and personal packs in the same model. A personal writing
style pack is still a pack. A local username, path, token, endpoint, or selected-profile value is
configuration.

## Source, Generated, Materialized

The expected repository shape is:

```text
packs/                 # canonical, human/agent-authored portable source
.packs/<target>/       # generated harness-native packages
.agents/plugins/       # generated Codex marketplace metadata
.claude-plugin/        # generated Claude Code marketplace metadata
configport.json        # local overlay state, wherever you choose to store it
```

The important distinction is not public versus private. It is source versus configuration.

## Harness As Shell, Skill As Executable

The intended UX is not a giant interactive CLI. The harness LLM should drive judgment-heavy work:

- migration decisions
- source-versus-configuration placement
- pack authoring
- setup questions
- release checks

The CLI should do deterministic work:

- discover packs
- validate contracts
- scan Claude source
- write approved migration files
- generate target packages
- write marketplaces
- store and apply overlays

This is why the repo contains control packs such as `packs/packport-control` and
`packs/configport-control`. They are normal packs that package the workflows agents should run.

## Current Products

`packport` owns:

- pack conventions under `packs/`.
- validation and discovery.
- migration from Claude Code plugin source.
- target generation for OpenCode and Codex user packs.
- generated control plugins for Claude Code.
- native marketplace metadata for Codex and Claude control packages.

`configport` owns:

- profiles and target selectors.
- local replacements.
- local overlay files.
- materializing generated output into a target location.
- keeping local values out of reusable pack source.

## Current Target Support

| Capability | Claude Code | OpenCode | Codex |
| --- | --- | --- | --- |
| control skills | generated control plugin | generated skills output | generated control plugin |
| user pack skills | design pending | generated | generated |
| user pack commands | design pending | generated command markdown | generated as skills |
| user pack agents | design pending | generated agent markdown | generated agents |
| hooks | design pending | warning only | warning only |
| marketplace metadata | generated for control plugins | not needed by current emitter | generated |

Use this table as a current-state guide, not the full product ambition.
