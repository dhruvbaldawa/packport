# Migrating From Claude Code

The Claude migration flow converts an existing Claude Code marketplace or plugin into portable pack
source. The tool reports facts and writes approved files; the harness skill and user make semantic
decisions.

## The Three Phases

1. `scan` inventories plugins and assets.
2. `plan` previews portable files and decision questions without writing.
3. `write` creates portable source only after questions are resolved or excluded.

Use the built-in `migrate-claude` skill for the interactive flow when possible.

## Scan

```bash
bun src/cli.ts migrate-claude scan /path/to/claude-source
```

The source can be:

- a marketplace repository with `.claude-plugin/marketplace.json`.
- a single Claude plugin directory with `.claude-plugin/plugin.json`.

The scanner finds Claude agents, commands, and skills. It also records structural facts such as:

- config-like paths.
- script references.
- variables that look like config, token, secret, credential, key, password, or env values.
- Claude-specific body references.

## Plan

```bash
bun src/cli.ts migrate-claude plan /path/to/claude-source
```

The planner shows the portable files it would create under `packs/`. It does not write files.

Assets with structural facts produce questions. Questions are not failures; they mark places where
a person or harness agent must decide whether something belongs in pack source or configport state.

Use exclusions after a decision:

```bash
bun src/cli.ts migrate-claude plan /path/to/claude-source --exclude-plugin notifications
bun src/cli.ts migrate-claude plan /path/to/claude-source --exclude-asset essentials/commit
```

Asset exclusions accept either:

```text
<plugin>/<asset>
<plugin>/<kind>/<asset>
```

## Write

```bash
bun src/cli.ts migrate-claude write /path/to/claude-source /tmp/portable-packs
```

`write` refuses to proceed while unresolved migration questions remain. Resolve them by changing the
source, excluding the plugin or asset, or rerunning after the user approves the mapping.

The writer creates source files such as:

```text
/tmp/portable-packs/packs/<plugin>/PACK.md
/tmp/portable-packs/packs/<plugin>/agents/<asset>/AGENT.md
/tmp/portable-packs/packs/<plugin>/commands/<asset>/COMMAND.md
/tmp/portable-packs/packs/<plugin>/skills/<asset>/ASSET.md
/tmp/portable-packs/packs/<plugin>/skills/<asset>/SKILL.md
```

Skills with support files are written as multi-payload assets. The generated `ASSET.md` declares
`SKILL.md` first and then the support files, so target generation keeps the skill body as the primary
payload while still scanning and packaging reusable references.

## Migration Judgment

Use these rules when answering migration questions:

- personal packs are still packs.
- Claude-specific behavior should be rewritten into portable source or kept target-specific.
- local names, paths, endpoints, and secrets belong in configport state.
- support scripts that implement reusable behavior belong in the pack.
- support files that encode local state belong in configport.
- support file contents are scanned for structural facts; path-only checks are not enough.

The migration primitive deliberately avoids guessing these boundaries from prose alone.
