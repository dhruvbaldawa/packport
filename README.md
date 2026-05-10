# packport

Portable agent-pack tooling for authoring reusable agent capabilities once and generating
harness-native output for Claude Code, OpenCode, and Codex.

Start with the user guide:

- [Quick start](docs/quick-start.md) gets the current repo checked and regenerated.
- [Guide index](docs/README.md) explains which document to read next.
- [Design](DESIGN.md) records the product direction and open design decisions.

Current implementation status:

- Portable pack source is discovered from `packs/`.
- Claude Code, OpenCode, and Codex user pack output can be generated under `.packs/`.
- Claude Code and Codex control packages and repo-local marketplaces are generated for dogfooding.
- Pack authoring, generation, release preparation, harness work, migration, and checks are available
  through generated `packport` control skills.
- `configport` overlays can materialize generated output with local replacements and files.
- Claude Code migration can scan, plan, and write portable source from existing Claude plugins.

## Development

- `bun run lint`
- `bun run typecheck`
- `bun run format:check`
- `bun test`
- `bun run check`
