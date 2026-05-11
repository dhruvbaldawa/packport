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

Successful output:

```text
No packport issues found.
```

Diagnostics use:

```text
ERROR <code> <path>: <message>
WARNING <code> <path>: <message>
```

## opencode generate

```bash
packport opencode generate <pack-root> <output-root> [--include-control-packs]
```

Generates one OpenCode package/config root per source pack under `<output-root>`.

Summary output includes generated package, command, agent, and skill counts.

By default, built-in `packport-control` and `configport-control` packs are skipped. Use
`--include-control-packs` only when regenerating packport's dogfood control output.

## claude generate

```bash
packport claude generate <pack-root> [output-root]
```

Generates one Claude Code plugin per pack and writes `.claude-plugin/marketplace.json` under the
pack root. When `output-root` is omitted, output goes to `<pack-root>/.packs/claude`.

Summary output includes plugin, command, agent, skill, and marketplace entry counts.

Built-in control packs are skipped. Use `control-plugin claude ...` to package Claude Code control
plugins.

## codex generate

```bash
packport codex generate <pack-root> [output-root] [--include-control-packs]
```

Generates one Codex plugin per pack and writes `.agents/plugins/marketplace.json` under the pack
root. When `output-root` is omitted, output goes to `<pack-root>/.packs/codex`.

Summary output includes plugin, skill, agent, and marketplace entry counts.

By default, built-in `packport-control` and `configport-control` packs are skipped. Use
`--include-control-packs` only when regenerating packport's dogfood control output.

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
