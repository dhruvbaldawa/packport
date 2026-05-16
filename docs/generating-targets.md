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

When `pack.lock.yaml` exists, `check` also replays the locked target generators in a temporary
workspace and compares committed generated files and the lockfile with the expected current output.

During target generation, command, agent, and skill primary payloads render declared `{{tool.*}}`
and `{{mcp.*}}` refs into target-specific prose. `{{config.*}}` refs are profile-local and block
package generation unless they are handled later through configport materialization.

Pack-level `.mcp.json` files are target material too. Claude Code receives the file directly,
OpenCode receives target-native `opencode.json` MCP entries, and Codex receives a managed block in
`.codex/config.toml`.

## Generate

```bash
bun src/cli.ts generate .
```

By default, generation runs Claude Code, OpenCode, and Codex in that order. Use repeatable
`--target` flags to limit the run:

```bash
bun src/cli.ts generate . --target codex
bun src/cli.ts generate . --target claude --target opencode --no-configport
```

Generation emits every discovered pack, including control packs. It also reads
`.configport/configport.json` and materializes instruction selections whose target is being
generated. `--no-configport` skips instruction materialization. Configport overlays stay explicit
through `configport apply`.

## OpenCode

```bash
bun src/cli.ts generate . --target opencode
```

The OpenCode emitter writes:

```text
.packs/opencode/<pack>/opencode.json
.packs/opencode/<pack>/.opencode/commands/<name>.md
.packs/opencode/<pack>/.opencode/agents/<name>.md
.packs/opencode/<pack>/.opencode/skills/<name>/SKILL.md
```

Current behavior:

- packs become separate OpenCode package/config roots.
- commands become OpenCode command markdown.
- agents become OpenCode subagent markdown.
- skills are copied into `.opencode/skills/`.
- skill support files are copied except packport source metadata.
- pack-level `.mcp.json` is merged into `opencode.json` as OpenCode MCP config.
- Claude-style `$ARGS` and `${{{ARGS}}}` placeholders become `$ARGUMENTS`.
- common Claude model names such as `claude-*` are converted to `anthropic/claude-*`.
- hooks are reported as unsupported warnings.

## Codex

```bash
bun src/cli.ts generate . --target codex
```

By default, Codex output is written under `.packs/codex/` and the local marketplace is written to
`.agents/plugins/marketplace.json`.

The Codex emitter writes one plugin per source pack:

```text
.packs/codex/<pack>/.codex-plugin/plugin.json
.packs/codex/<pack>/skills/<name>/SKILL.md
.packs/codex/<pack>/agents/<name>.md
.agents/plugins/marketplace.json
.codex/config.toml
```

Current behavior:

- packs become Codex plugins.
- skills become Codex skills.
- commands become Codex skills.
- agents become Codex agents.
- skill support files are copied.
- pack-level `.mcp.json` is written into a packport-managed `.codex/config.toml` block.
- existing non-generated marketplace entries are preserved.
- generated marketplace entries are replaced by pack name.
- output paths must stay under `.packs/` and outside `packs/` and `.agents/`.
- hooks are reported as unsupported warnings.

## Claude Code

```bash
bun src/cli.ts generate . --target claude
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

- packs become Claude Code plugins.
- commands become Claude slash-command markdown.
- agents become Claude subagent markdown.
- skills are copied into `skills/`.
- skill support files are copied except packport source metadata.
- pack-level `.mcp.json` is copied into the generated plugin.
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
run generate
run project quality gate
commit source and generated output together when generated output is part of distribution
```

Generated output is not a separate source of truth.
