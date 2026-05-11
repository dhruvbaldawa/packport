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

During target generation, command, agent, and skill primary payloads render declared `{{tool.*}}`
and `{{mcp.*}}` refs into target-specific prose. `{{config.*}}` refs are profile-local and block
package generation unless they are handled later through configport materialization.

## OpenCode

```bash
bun src/cli.ts opencode generate . .packs/opencode
```

The OpenCode emitter writes:

```text
.packs/opencode/<pack>/opencode.json
.packs/opencode/<pack>/.opencode/commands/<name>.md
.packs/opencode/<pack>/.opencode/agents/<name>.md
.packs/opencode/<pack>/.opencode/skills/<name>/SKILL.md
```

Current behavior:

- built-in control packs are skipped unless `--include-control-packs` is passed for packport
  dogfood output.
- packs become separate OpenCode package/config roots.
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

- built-in control packs are skipped unless `--include-control-packs` is passed for packport
  dogfood output.
- packs become Codex plugins.
- skills become Codex skills.
- commands become Codex skills.
- agents become Codex agents.
- skill support files are copied.
- existing non-generated marketplace entries are preserved.
- generated marketplace entries are replaced by pack name.
- output paths must stay under `.packs/` and outside `packs/` and `.agents/`.
- hooks are reported as unsupported warnings.

## Claude Code

```bash
bun src/cli.ts claude generate .
```

By default, Claude output is written under `.packs/claude/` and the local marketplace is written to
`.claude-plugin/marketplace.json`.

The Claude emitter writes one plugin per source pack:

```text
.packs/claude/<pack>/.claude-plugin/plugin.json
.packs/claude/<pack>/commands/<name>.md
.packs/claude/<pack>/agents/<name>.md
.packs/claude/<pack>/skills/<name>/SKILL.md
.claude-plugin/marketplace.json
```

Current behavior:

- built-in control packs are skipped; use `control-plugin claude ...` for Claude Code control
  plugins.
- packs become Claude Code plugins.
- commands become Claude slash-command markdown.
- agents become Claude subagent markdown.
- skills are copied into `skills/`.
- skill support files are copied except packport source metadata.
- existing non-generated marketplace entries are preserved.
- generated marketplace entries are replaced by pack name.
- instruction assets are materialized by configport, not by plugin generation.
- hooks are reported as unsupported warnings.

## Claude Code Control Plugins

Control plugin generation packages the built-in control skills.

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
