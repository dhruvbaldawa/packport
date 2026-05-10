# Generating Targets

Generate target packages from `packs/` and commit the output when it is part of your distribution
story. Do not edit generated files by hand; update source packs or configport state and regenerate.

## Validate Before Generating

```bash
bun src/cli.ts check .
```

The check command reports errors and warnings in a stable format:

```text
ERROR <code> <path>: <message>
WARNING <code> <path>: <message>
```

A warning-only result is still usable. Any error should be fixed before generation.

## OpenCode

```bash
bun src/cli.ts opencode generate . .packs/opencode
```

The OpenCode emitter writes:

```text
.packs/opencode/opencode.json
.packs/opencode/.opencode/commands/<name>.md
.packs/opencode/.opencode/agents/<name>.md
.packs/opencode/.opencode/skills/<name>/SKILL.md
```

Current behavior:

- commands become OpenCode command markdown.
- agents become OpenCode subagent markdown.
- skills are copied into `.opencode/skills/`.
- skill support files are copied except packport source metadata.
- Claude-style `$ARGS` and `${{{ARGS}}}` placeholders become `$ARGUMENTS`.
- common Claude model names such as `claude-*` are converted to `anthropic/claude-*`.
- hooks are reported as unsupported warnings.

## Codex

```bash
bun src/cli.ts codex generate .
```

By default, Codex output is written under `.packs/codex/` and the local marketplace is written to
`.agents/plugins/marketplace.json`.

The Codex emitter writes one plugin per source pack:

```text
.packs/codex/<pack>/.codex-plugin/plugin.json
.packs/codex/<pack>/skills/<name>/SKILL.md
.packs/codex/<pack>/agents/<name>.md
.agents/plugins/marketplace.json
```

Current behavior:

- packs become Codex plugins.
- skills become Codex skills.
- commands become Codex skills.
- agents become Codex agents.
- skill support files are copied.
- existing non-generated marketplace entries are preserved.
- generated marketplace entries are replaced by pack name.
- output paths must stay under `.packs/` and outside `packs/` and `.agents/`.
- hooks are reported as unsupported warnings.

## Claude Code Control Plugins

Claude generation currently packages the built-in control skills, not arbitrary user packs.

```bash
bun src/cli.ts control-plugin claude .packs/claude/packport
bun src/cli.ts control-plugin claude configport .packs/claude/configport
bun src/cli.ts control-plugin claude-marketplace .
```

The first command packages `packs/packport-control`. The second packages
`packs/configport-control`. The marketplace command writes:

```text
.claude-plugin/marketplace.json
```

It points to:

```text
.packs/claude/packport
.packs/claude/configport
```

## Safety Model

Generators plan writes first, check target collisions, reject unsafe symlink traversal, and then
write output. If an error is reported, treat the generated output as failed and fix the source or
target path before rerunning.

## Regeneration Policy

The intended loop is:

```text
edit packs/ or configport state
run check
generate target output
run project quality gate
commit source and generated output together when generated output is part of distribution
```

Generated output is not a separate source of truth.
