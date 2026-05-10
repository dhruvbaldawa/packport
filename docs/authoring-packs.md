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

The current implementation discovers these asset kinds:

```text
packs/<pack>/
  agents/<name>/AGENT.md
  commands/<name>/COMMAND.md
  hooks/<name>/HOOK.md
  skills/<name>/SKILL.md
```

The payload file is opaque to packport except where a target emitter adapts native frontmatter.
Support files inside a skill directory are copied by the OpenCode and Codex generators.

The locked v1 design adds runtime instruction assets:

```text
packs/<pack>/instructions/<name>/INSTRUCTION.md
```

`PACK.md` and `ASSET.md` are control-plane Markdown for packport, configport, and skills.
`INSTRUCTION.md` is runtime payload Markdown: it is reusable guidance that configport can
materialize into target files such as `CLAUDE.md`, `AGENTS.md`, or OpenCode rule/config files.

## Optional ASSET.md

Add `ASSET.md` inside an asset directory only for non-obvious packaging facts.

Accepted frontmatter fields are:

```markdown
---
payload: README.md
payloads:
  - SKILL.md
  - helper.ts
---
```

Rules:

- use either `payload` or `payloads`, not both.
- payload paths must be relative to the asset directory.
- payload paths must not contain `..` or absolute paths.
- the locked v1 design removes the legacy `templated` field; do not use it in new pack source.

## Portable Refs

The locked v1 design makes payload files explicit-ref-aware by default:

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
target-specific prose or config; unresolved config refs block configport apply.

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
