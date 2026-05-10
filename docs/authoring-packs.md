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

`PACK.md` must start with these keys before the first heading:

```markdown
Name: Essentials
Version: 0.1.0
Description: Core workflows for repository maintenance.
```

Those are the only structured keys currently accepted in `PACK.md`.

## Asset Directories

packport discovers these asset kinds:

```text
packs/<pack>/
  agents/<name>/AGENT.md
  commands/<name>/COMMAND.md
  hooks/<name>/HOOK.md
  skills/<name>/SKILL.md
```

The payload file is opaque to packport except where a target emitter adapts native frontmatter.
Support files inside a skill directory are copied by the OpenCode and Codex generators.

## Optional ASSET.md

Add `ASSET.md` inside an asset directory only for non-obvious packaging facts.

Accepted keys are:

```markdown
Payload: README.md
Payloads: SKILL.md, helper.ts
Templated: true
```

Rules:

- use either `Payload` or `Payloads`, not both.
- payload paths must be relative to the asset directory.
- payload paths must not contain `..` or absolute paths.
- `Templated` must be `true` or `false`.

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
- materialized target-tool settings

If a value would make sense for another user of the pack, it is probably source. If it only makes
sense for one user, machine, profile, or installation, it is probably configport state.
