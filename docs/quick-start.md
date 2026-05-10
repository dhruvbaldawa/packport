# Quick Start

In one pass, you can validate the current pack source, regenerate the dogfood packages, and make the
generated control packs available to Claude Code, OpenCode, and Codex.

The commands below run from the packport source tree. Until a packaged binary exists, use
`bun src/cli.ts ...` wherever this guide says `packport ...`.

## Prerequisites

- Bun `>=1.3.3`
- Node `>=22.22.2`
- repository dependencies installed with `bun install` in a fresh checkout

## 1. Validate Pack Source

```bash
bun src/cli.ts check .
```

Expected successful output:

```text
No packport issues found.
```

This checks the `packs/` tree and reports invalid `PACK.md`, `ASSET.md`, missing payloads, and
lockfile drift when `pack.lock.yaml` exists.

## 2. Regenerate Dogfood Output

```bash
bun src/cli.ts claude generate .
bun src/cli.ts opencode generate . .packs/opencode
bun src/cli.ts codex generate .
bun src/cli.ts control-plugin claude .packs/claude/packport
bun src/cli.ts control-plugin claude configport .packs/claude/configport
bun src/cli.ts control-plugin claude-marketplace .
```

These commands produce:

- `.packs/claude/` with Claude Code plugins.
- `.packs/opencode/` with OpenCode repo-local skills and `opencode.json`.
- `.packs/codex/packport-control/` and `.packs/codex/configport-control/`.
- `.agents/plugins/marketplace.json` for Codex local plugins.
- `.packs/claude/packport/` and `.packs/claude/configport/`.
- `.claude-plugin/marketplace.json` for Claude Code local plugins.

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

- `check-pack` validates a portable pack repository.
- `migrate-claude` scans and plans migration from Claude Code plugin source.
- `configure-pack` records local replacements and overlay files.
- `apply-pack` materializes generated output through a selected configport profile.

## 5. First Real Workflow

Start with a small pack repository or a copy of `ccconfigs`:

```bash
bun src/cli.ts migrate-claude scan /path/to/claude-plugin-or-marketplace
bun src/cli.ts migrate-claude plan /path/to/claude-plugin-or-marketplace
```

Resolve any questions the plan reports. Then write portable source to a separate output directory:

```bash
bun src/cli.ts migrate-claude write /path/to/claude-plugin-or-marketplace /tmp/portable-packs
```

From there, validate and generate target output:

```bash
bun src/cli.ts check /tmp/portable-packs
bun src/cli.ts codex generate /tmp/portable-packs
bun src/cli.ts opencode generate /tmp/portable-packs /tmp/portable-packs/.packs/opencode
```
