# Authoring Packs

A portable pack is a directory under `packs/` with one `PACK.md` and optional asset directories.
Keep payload files focused on agent behavior. Use `ASSET.md` only when a payload needs packaging
facts that the directory convention cannot express.

## Minimal Pack

```text
packs/
  essentials/
    PACK.md
    skills/
      check-repo/
        SKILL.md
```

`PACK.md` must start with YAML frontmatter containing these fields:

```markdown
---
name: Essentials
version: 0.1.0
description: Core workflows for repository maintenance.
---
```

Those are the only structured fields currently accepted in `PACK.md`.

## Asset Directories

packport discovers these asset kinds:

```text
packs/<pack>/
  agents/<name>/AGENT.md
  commands/<name>/COMMAND.md
  hooks/<name>/HOOK.md
  instructions/<name>/INSTRUCTION.md
  skills/<name>/SKILL.md
```

The payload file is opaque to packport except where a target emitter adapts native frontmatter.
Support files inside an asset directory are discovered automatically, recorded in
`pack.lock.yaml`, and copied by generators that support that asset kind. Do not list reference
files, examples, or helper scripts in `ASSET.md` just so they get packaged.

`PACK.md` and `ASSET.md` are control-plane Markdown for packport, configport, and skills.
`INSTRUCTION.md` is runtime payload Markdown: it is reusable guidance that configport can
materialize into target files. Claude selections write `CLAUDE.md`; Codex and OpenCode selections
write `AGENTS.md`.

## Optional ASSET.md

Add `ASSET.md` inside an asset directory only for non-obvious packaging facts.

Accepted frontmatter fields are:

```markdown
---
payload: README.md
payloads:
  - SKILL.md
  - EXTRA.md
---
```

Rules:

- use either `payload` or `payloads`, not both.
- payload paths must be relative to the asset directory.
- payload paths must not contain `..` or absolute paths.
- do not use `payloads` to enumerate support files; support files are discovered automatically.
- `templated` is not accepted.

## Pack-Level MCP

Put portable MCP server declarations in a pack-level `.mcp.json` using Claude's `mcpServers`
shape. Generation distributes that declaration to every target:

- Claude Code copies `.mcp.json` into the generated plugin.
- OpenCode writes matching entries into `opencode.json`.
- Codex writes a packport-managed MCP block into `.codex/config.toml`.

## Portable Refs

Payload files are explicit-ref-aware by default:

```md
Use {{tool.git.read}} before summarizing repository state.
Write review notes in {{config.review_voice}}.
Start {{mcp.todoist}} only when the selected profile enables it.
```

Supported namespaces are only:

- `{{config.*}}`
- `{{tool.*}}`
- `{{mcp.*}}`

Portable refs are not a template language. Loops, filters, expressions, conditionals, partials, and
implicit variable discovery are not supported. Refs should be declared in `PACK.md` or `ASSET.md`
using the supported prose sections below. Installed target files should render refs into
target-specific prose or config.

Target package generation renders declared `{{tool.*}}` and `{{mcp.*}}` refs in command, agent, and
skill payloads. `{{config.*}}` refs need profile answers, so they block target package generation
unless the asset is materialized later by configport, such as selected `INSTRUCTION.md` assets.
Unresolved config refs also block configport apply.

The built-in v1 alias map starts intentionally small:

- `{{tool.fs.read}}`
- `{{tool.fs.write}}`
- `{{tool.git.read}}`
- `{{tool.git.write}}`
- `{{tool.shell.git}}`
- `{{mcp.todoist}}`

Unknown `tool.*` and `mcp.*` aliases fail validation until a resolver or harness reference knows how
to explain or materialize them for Claude Code, OpenCode, and Codex.

## Supported Sections

`PACK.md` and `ASSET.md` can include prose sections after headings. Known section names are:

- `Configuration`
- `Dependencies`
- `Needs`
- `Notes`
- `Source Constraints`
- `Experimental:<name>`

Unknown sections are warnings, not errors. Prefer known sections when the content is meant for
portable tooling or for future target emitters.

## Naming For Portability

For the smoothest cross-target path, use lowercase hyphenated pack and asset names:

```text
good-name
debugging
senior-engineer-reviewer
```

Codex and OpenCode both reject names outside a lowercase alphanumeric hyphen grammar for generated
skills or plugins. Keep names at 64 characters or less.

## What To Put Where

Put this in pack source:

- reusable instructions
- instruction assets under `instructions/<name>/INSTRUCTION.md`
- skill workflows
- agent roles
- command bodies
- support scripts that are part of the pack behavior
- safe defaults and pack-owned customization declarations

Put this in configport state:

- local names
- local paths
- usernames
- secrets or secret references
- private endpoints
- selected packs for one profile
- selected instruction assets for a target and scope
- materialized target-tool settings

If a value would make sense for another user of the pack, it is probably source. If it only makes
sense for one user, machine, profile, or installation, it is probably configport state.
