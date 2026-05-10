# Dogfooding

Dogfood packport in two layers. First, use this repo's generated control packs to exercise the
tooling. Second, point the migration flow at a real Claude-first pack repository such as
`ccconfigs`.

## Regenerate The Built-In Control Packs

From the packport repo:

```bash
bun src/cli.ts check .
bun src/cli.ts claude generate .
bun src/cli.ts opencode generate . .packs/opencode --include-control-packs
bun src/cli.ts codex generate . --include-control-packs
bun src/cli.ts control-plugin claude .packs/claude/packport
bun src/cli.ts control-plugin claude configport .packs/claude/configport
bun src/cli.ts control-plugin claude-marketplace .
bun run check
```

These are the committed dogfood entry points:

- Claude Code: `.claude-plugin/marketplace.json`
- Codex: `.agents/plugins/marketplace.json`
- OpenCode: `.packs/opencode/`

The control-pack inclusion flag is only for this repository's generated control packs. Normal
portable pack repositories should let generation skip tool-owned control packs.

## Use The Harness As The Shell

After the local packages are available in your harness, use the generated skills rather than
manually stepping through every primitive:

- ask `author-pack` to create or extend portable pack source.
- ask `check-pack` to validate this repo or another pack repo.
- ask `generate-pack` to regenerate harness-native output.
- ask `migrate-claude` to inspect a Claude marketplace or plugin.
- ask `release-pack` to prepare source, generated output, and lockfiles for handoff.
- ask `add-harness` to guide adapter implementation work.
- ask `configure-pack` to turn approved local literals into configport overlays.
- ask `apply-pack` to materialize generated output for a selected profile.

The skills should call the CLI primitives. The CLI should not become the main interactive surface.

## Migrate A Real Claude-First Repo

Start with read-only inspection:

```bash
bun src/cli.ts migrate-claude scan /path/to/ccconfigs
bun src/cli.ts migrate-claude plan /path/to/ccconfigs
```

Review every question. Decide whether each questioned item is:

- reusable pack source.
- target-specific behavior.
- configport-managed local state.
- out of scope for the current migration.

Then write source to a separate directory:

```bash
bun src/cli.ts migrate-claude write /path/to/ccconfigs /tmp/ccconfigs-portable
```

If questions remain, rerun with accepted exclusions:

```bash
bun src/cli.ts migrate-claude write /path/to/ccconfigs /tmp/ccconfigs-portable \
  --exclude-plugin notifications \
  --exclude-asset essentials/todoist
```

Validate and generate from the portable output:

```bash
bun src/cli.ts check /tmp/ccconfigs-portable
bun src/cli.ts codex generate /tmp/ccconfigs-portable
bun src/cli.ts opencode generate /tmp/ccconfigs-portable /tmp/ccconfigs-portable/.packs/opencode
```

## What Good Dogfooding Should Prove

The project is working when:

- pack source remains readable and editable.
- generated packages are reproducible.
- local values move into configport state.
- Claude migration questions are explicit rather than hidden.
- OpenCode and Codex output can be regenerated from the same source packs.
- no packport code path knows about one user's private paths or personal defaults.
