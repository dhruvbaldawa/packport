# Configuring With configport

configport applies local profile overlays to generated package output. Use it when a generated pack
contains literals or files that must vary by user, machine, profile, or target harness.

## The Model

One overlay is selected by:

```text
profile + target + pack
```

It can contain:

- replacements: exact text substitutions applied to generated files.
- files: local files written into the materialized output tree.
- instruction selections: chosen `INSTRUCTION.md` assets plus local `config.*` answers.

The state file is named `configport.json` and lives under the state root you choose.

## Store Replacements

```bash
bun src/cli.ts configport overlay put .configport personal codex essentials \
  --replace "Existing Name=New Name" \
  --replace "/old/local/path=/new/local/path"
```

The selector above means:

- state root: `.configport`
- profile: `personal`
- target: `codex`
- pack: `essentials`

Running `overlay put` for the same selector replaces that selector's overlay. Other overlays in the
same `configport.json` are preserved.

## Store Local Files

```bash
bun src/cli.ts configport overlay put .configport personal codex essentials \
  --file "settings.local.json={\"enabled\":true}"
```

Use file overlays only for local/profile-specific files. Reusable behavior should move into pack
source instead.

## Apply An Overlay

```bash
bun src/cli.ts configport apply .configport .packs/codex/essentials .materialized/codex/essentials \
  --profile personal \
  --target codex \
  --pack essentials
```

This copies generated files from `.packs/codex/essentials`, applies replacements, adds overlay
files, and writes the result to `.materialized/codex/essentials`.

The output path must not be the generated package path or inside it.

## Check An Overlay

```bash
bun src/cli.ts configport check .configport .packs/codex/essentials .materialized/codex/essentials \
  --profile personal \
  --target codex \
  --pack essentials
```

This recomputes the selected overlay result without writing files. It reports missing materialized
files and output drift when the existing materialized tree no longer matches generated output plus
the selected overlay.

## Materialize Instructions

Store selected runtime instruction assets separately from generated package overlays:

```bash
bun src/cli.ts configport instructions put .configport personal codex essentials project \
  --instruction repo-workflow \
  --answer "review_voice=direct reviewer prose"
```

Then materialize them into the target scope root:

```bash
bun src/cli.ts configport instructions apply .configport . .materialized/codex/project \
  --profile personal \
  --target codex \
  --pack essentials \
  --scope project
```

For Claude Code, configport writes a managed block to `CLAUDE.md`. For Codex and OpenCode, it
writes a managed block to `AGENTS.md`. Existing unmanaged file content is preserved; rerunning
instruction apply replaces only the matching packport managed block.

Instruction materialization renders `{{config.*}}`, `{{tool.*}}`, and `{{mcp.*}}` refs before
writing. Missing answers or leftover portable refs block the write.

## What Not To Do

- Do not put secrets in reusable pack source.
- Do not hand-edit `.packs/<target>/` after generation.
- Do not use overlays for behavior that every user of the pack should receive.
- Do not materialize output back into source `packs/`.

## Safety Checks

configport rejects:

- empty profile, target, or pack selectors.
- empty replacement source text.
- unsafe overlay file paths.
- duplicate overlay file paths.
- missing generated output.
- missing materialized output during check.
- materialized output drift during check.
- symlinks in generated, state, or materialized output paths.
- materialized output paths that collide with each other.
