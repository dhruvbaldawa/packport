# CLI Reference

The CLI exposes deterministic primitives. The package installs a `packport` executable backed by
Bun. From a source checkout, link it before dogfooding generated control skills:

```bash
bun link
packport check .
```

During development, `bun src/cli.ts ...` remains equivalent to `packport ...`.

## check

```bash
packport check [root]
```

Validates a portable pack repository. Defaults to the current working directory.

When `pack.lock.yaml` exists, `check` also replays the locked target generators in a temporary
workspace and reports committed generated output or lockfiles that differ from current generator
output.

Successful output:

```text
No packport issues found.
```

Diagnostics use:

```text
ERROR <code> <path>: <message>
WARNING <code> <path>: <message>
```

## generate

```bash
packport generate [root] [--target <claude|opencode|codex>]... [--no-configport]
```

Generates target packages from source packs. Defaults to the current working directory and, when
`--target` is omitted, generates Claude Code, OpenCode, and Codex output in that stable order.
`--target` is repeatable and duplicate targets are ignored.

Default output roots are:

- Claude Code: `<root>/.packs/claude` plus `<root>/.claude-plugin/marketplace.json`
- OpenCode: `<root>/.packs/opencode`
- Codex: `<root>/.packs/codex` plus `<root>/.agents/plugins/marketplace.json`

All discovered packs are generated, including control packs. If `<root>/.configport/configport.json`
contains instruction selections for generated targets, `generate` materializes those managed
instruction blocks into `<root>/CLAUDE.md` or `<root>/AGENTS.md`. Use `--no-configport` to skip
that instruction materialization. Configport overlays remain explicit through `configport apply`.

Examples:

```bash
packport generate .
packport generate . --target codex
packport generate . --target claude --target opencode --no-configport
```

Summary output includes one line per generated target and, when instruction selections are
materialized, one configport line.

## install

```bash
packport install [root] [--target <claude|opencode|codex>]... [--dry-run] [--no-configport] \
  [--codex-home <path>] [--agents-root <path>] \
  [--claude-home <path>] [--opencode-config-root <path>]
```

Installs generated output into target-tool global configuration roots. Defaults to the current
working directory and, when `--target` is omitted, installs Claude Code, OpenCode, and Codex in
that stable order. Install runs generation first unless `--dry-run` is set.

Default install roots are:

- Claude Code: `~/.claude/settings.json` plus `~/.claude/CLAUDE.md` for user instructions.
- OpenCode: `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`.
- Codex: `$CODEX_HOME` or `~/.codex`, plus `~/.agents/plugins/marketplace.json`.

`--dry-run` reads existing generated output and prints planned writes without changing tool homes.
`--no-configport` skips project and user instruction materialization during install.

## control-plugin claude

```bash
packport control-plugin claude <output> [source-root]
packport control-plugin claude configport <output> [source-root]
```

Generates Claude Code control plugins from built-in control pack source.

- `claude <output>` packages `packs/packport-control`.
- `claude configport <output>` packages `packs/configport-control`.

## control-plugin claude-marketplace

```bash
packport control-plugin claude-marketplace <repo-root> [package-root]
```

Writes `<repo-root>/.claude-plugin/marketplace.json` pointing at the generated `packport` and
`configport` Claude control plugins. When `package-root` is omitted, it defaults to
`<repo-root>/.packs/claude`.

## migrate-claude scan

```bash
packport migrate-claude scan [root]
```

Scans a Claude Code marketplace root or a single Claude plugin directory. Defaults to the current
working directory.

## migrate-claude plan

```bash
packport migrate-claude plan [root] \
  [--accept-asset <plugin/name>]... \
  [--exclude-plugin <name>]... \
  [--exclude-asset <plugin/name>]...
```

Builds a read-only migration plan. Reports planned files and decision questions. Use
`--accept-asset` after reviewing a questioned asset that should remain pack source.

## migrate-claude write

```bash
packport migrate-claude write <source> <output> \
  [--accept-asset <plugin/name>]... \
  [--exclude-plugin <name>]... \
  [--exclude-asset <plugin/name>]...
```

Writes portable pack source from an approved migration plan. The command fails when unresolved
questions remain.

## configport overlay put

```bash
packport configport overlay put <state-root> <profile> <target> <pack> \
  [--replace <from=to>]... \
  [--file <path=content>]...
```

Stores or replaces one overlay selector in `<state-root>/configport.json`.

## configport apply

```bash
packport configport apply <state-root> <generated> <output> \
  --profile <profile> \
  --target <target> \
  --pack <pack>
```

Copies generated output to a materialized output tree, applies replacements, and adds overlay
files for the selected overlay.

## configport check

```bash
packport configport check <state-root> <generated> <output> \
  --profile <profile> \
  --target <target> \
  --pack <pack>
```

Checks the materialized output tree without writing files. Reports missing files and drift from the
expected generated output plus selected overlay.

## configport instructions put

```bash
packport configport instructions put <state-root> <profile> <target> <pack> <scope> \
  --instruction <name>... \
  [--answer <key=value>]...
```

Stores selected `INSTRUCTION.md` assets and local `config.*` answers in
`<state-root>/configport.json`.

## configport instructions apply

```bash
packport configport instructions apply <state-root> <pack-root> <output> \
  --profile <profile> \
  --target <target> \
  --pack <pack> \
  --scope <scope>
```

Renders selected instruction assets and writes a managed block to the target instruction file under
`<output>`.
