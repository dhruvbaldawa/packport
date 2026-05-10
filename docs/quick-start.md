# Quick Start

In one pass, you can validate the current pack source, regenerate the dogfood packages, and make the
generated control packs available to Claude Code, OpenCode, and Codex.

The commands below run from the packport source tree. The packaged binary is named `packport`;
`bun src/cli.ts ...` remains available as the development equivalent.

## Prerequisites

- Bun `>=1.3.3`
- Node `>=22.22.2`
- repository dependencies installed with `bun install` in a fresh checkout

## 0. Expose The CLI

Generated control skills call `packport`, so dogfooding should use the package bin:

```bash
bun link
packport check .
```

If you are only running primitives from this source tree, `bun src/cli.ts ...` is still equivalent.

## 1. Validate Pack Source

```bash
packport check .
```

Expected successful output:

```text
No packport issues found.
```

This checks the `packs/` tree and reports invalid `PACK.md`, `ASSET.md`, missing payloads, and
lockfile drift when `pack.lock.yaml` exists.

## 2. Regenerate Dogfood Output

```bash
packport claude generate .
packport opencode generate . .packs/opencode --include-control-packs
packport codex generate . --include-control-packs
packport control-plugin claude .packs/claude/packport
packport control-plugin claude configport .packs/claude/configport
packport control-plugin claude-marketplace .
```

These commands produce:

- `.packs/claude/` with Claude Code plugins.
- `.packs/opencode/` with OpenCode repo-local skills and `opencode.json`.
- `.packs/codex/packport-control/` and `.packs/codex/configport-control/`.
- `.agents/plugins/marketplace.json` for Codex local plugins.
- `.packs/claude/packport/` and `.packs/claude/configport/`.
- `.claude-plugin/marketplace.json` for Claude Code local plugins.

The `--include-control-packs` flag is for packport's dogfood control packs. Ordinary pack
repositories should omit it so tool-owned control workflows do not appear as user pack plugins.

## 3. Run The Full Quality Gate

```bash
bun run check
```

This runs format, lint, typecheck, and tests.

## 4. Try The Control Packs

Use the generated marketplace files as the local package entry points for your harness:

- Codex: `.agents/plugins/marketplace.json`
- Claude Code: `.claude-plugin/marketplace.json`
- OpenCode: `.packs/opencode/opencode.json` and `.packs/opencode/.opencode/skills/`

Then invoke a generated control skill:

- `author-pack` creates or extends portable pack source.
- `check-pack` validates a portable pack repository.
- `generate-pack` regenerates target packages and marketplaces.
- `migrate-claude` scans and plans migration from Claude Code plugin source.
- `release-pack` prepares source, generated output, and lockfiles for handoff.
- `add-harness` guides target adapter implementation.
- `configure-pack` records local replacements and overlay files.
- `apply-pack` materializes generated output through a selected configport profile.

## 5. First Real Workflow

Start with a small pack repository or a copy of `ccconfigs`:

```bash
packport migrate-claude scan /path/to/claude-plugin-or-marketplace
packport migrate-claude plan /path/to/claude-plugin-or-marketplace
```

Resolve any questions the plan reports. Then write portable source to a separate output directory:

```bash
packport migrate-claude write /path/to/claude-plugin-or-marketplace /tmp/portable-packs
```

From there, validate and generate target output:

```bash
packport check /tmp/portable-packs
packport codex generate /tmp/portable-packs
packport opencode generate /tmp/portable-packs /tmp/portable-packs/.packs/opencode
```
