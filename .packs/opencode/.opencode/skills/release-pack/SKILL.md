---
name: release-pack
description: "Prepare portable packs and generated harness packages for local dogfood or publication. Use before committing release artifacts, sharing packs, or publishing marketplace metadata."
---

# Release Pack

## Purpose

Use this skill to prepare a pack repository for distribution while keeping source, generated output, and local configuration boundaries clear.

## Workflow

1. Confirm the release scope: local dogfood, branch handoff, tagged release, or marketplace publication.
2. Inspect changed source packs and confirm pack versions in `PACK.md` are intentional.
3. Run `packport check <root>`. Stop on errors.
4. Run `generate-pack` for the requested targets.
5. Run the repository quality gate when available, such as `bun run check` in the packport repository.
6. Review native marketplace files and `.packs/<target>/` entries for expected local or publication sources.
7. Verify no configport state, local answers, secrets, or machine paths were committed into generated package output.
8. Summarize source changes, generated artifacts, lockfile status, validation commands, and unresolved release risks.

## Boundaries

- Do not publish, tag, push, or rewrite history unless the user explicitly asks for that action.
- Do not decide semantic version bumps without user confirmation.
- Do not move profile-local configport state into portable pack source or committed generated packages.
