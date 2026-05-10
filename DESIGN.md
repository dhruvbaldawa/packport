ABOUTME: Captures the current design for an open-source portable agent-pack authoring tool.
ABOUTME: Documents how ccconfigs dogfoods the tools, plus current decisions and unresolved design work.

# packport Portable Agent Packs Design

## Status

This is a design snapshot before walking through user journeys. It records current decisions, working assumptions, and unresolved questions.

## Goal

Build `packport`, an open-source tool that helps people create portable agent packs that work across multiple agent harnesses.

The project lives in `/home/dhruv/Code/packport`. `ccconfigs` is the dogfood repository for the tools. It should prove `packport` can migrate a real Claude Code-first pack collection into a portable format without baking Dhruv-specific assumptions into the generic tools.

## First Principles

What this is trying to achieve:

- Let people author useful agent capabilities once and reuse them across harnesses.
- Let the harness LLM drive ambiguous work such as migration, setup, classification, and tradeoff decisions.
- Keep deterministic code for boring operations: discover files, copy files, render tiny wrappers, install outputs, and check drift.
- Keep pack content readable enough that humans and LLMs can edit it without learning a large configuration language.
- Let pack repositories declare their own customization options without those options becoming part of the generic tool.
- Keep real payload content single-purpose: it should express agent behavior, instructions, or executable code, not portable-pack metadata.

Occam's razor:

- Do not build a universal agent-config compiler unless a simpler pack convention fails.
- Do not model every harness feature in schema.
- Do not centralize user-authored asset details into one manifest.
- Do not hide tool metadata inside payload files.
- Do not force YAML when Markdown plus directory conventions are enough.
- Do not make adapters smart when a skill can make the judgment and write local notes.

Simplified authoring does not mean reduced target fidelity. The tool should still aim to generate full native harness output where the harness has stable documented support. The simplification is in how users author packs, not in what the tool can emit.

Full-scope requirements:

- Native permission rendering for supported targets.
- Native hook rendering, not just copying or documenting hook intent.
- Pack-owned customization declarations; local answers and cross-tool application belong to the configuration tool.
- Full Codex adapter for documented Codex surfaces, not a skill-only placeholder.

The simplest useful product is:

```text
Markdown pack conventions
+ built-in migration/setup/authoring skills
+ thin Bun/TS primitives for discovery, validation, packaging, install, and drift checks
+ target resolvers that turn conventions and optional contracts into target plans
+ native harness emitters for stable target file formats
+ generated packport control plugins/skills for each supported harness
```

The tool should optimize for successful AI-assisted authoring, not perfect static modeling.

## Mental Model

```text
harness/agent = shell and driver
packport = pack conventions, validators, resolvers, emitters, installers, and pack control skills
configport = profiles, selected packs, local values, scopes, and target-tool config application
pack repo = pack content, customization declarations, generated packages, and source docs
skills = agent-facing workflows that use local context and call deterministic tool primitives
```

The user should usually interact through skills inside Claude Code, OpenCode, Codex, or another harness. The tool should still expose deterministic commands, but those commands are primitives, not the primary UX.

`packport` has two generated output categories:

- Control plugins: harness-native packages that install `packport` skills such as migration, authoring, checking, and release workflows.
- User pack plugins: generated packages for the portable packs authored by users or dogfood repositories.

Actual interactive execution should happen through control skills. CLI commands should be deterministic primitives that skills call, not the main authoring interface.

## SOLID Boundaries

The design must keep responsibilities separate:

- Payload files have one reason to change: the instructions, behavior, or executable content changed.
- Asset contracts have one reason to change: packaging facts, capability intent, dependencies, or configuration needs changed.
- Target resolvers have one reason to change: mapping portable contracts to a target plan changed.
- Emitters have one reason to change: a target harness format or rendering policy changed.
- Skills have one reason to change: the authoring, migration, setup, or decision workflow changed.
- The pack index depends on an `AssetContract` abstraction, not on comments or headings hidden inside payload files.
- Adding a new harness should add an emitter/reference, not require edits to every payload file.
- Adding a new asset kind should extend discovery and contracts, not force unrelated emitters to understand unused fields.

No file should be both the thing an agent reads as capability content and the tool's control plane for packaging that capability.

## Repository Split

The project should start as one monorepo named `packport`, with separate packages for separate products:

```text
packport/
  packages/
    packport/          # pack source -> tool-native plugins, marketplaces, and generated pack output
    configport/        # profiles, selected packs, scopes, and tool config application
    harnesses/         # shared Claude/OpenCode/Codex paths, schemas, and target facts
    core/              # shared diagnostics, filesystem safety, and lock helpers
```

The implementation can remain flat while only `packport` exists. Once configuration work starts, it should move into a sibling package instead of becoming more `packport` surface area.

`packport` owns:

- Pack authoring conventions.
- Built-in control skills and their harness-specific packaging.
- Lightweight Markdown discovery and indexing.
- Thin harness emitters.
- Target resolvers and default mappings for standard asset kinds.
- Built-in skill recipes for semantic mappings such as permissions, hooks, customization, and Codex surfaces.
- Static validators.
- Migration scanners.
- Pack install and uninstall primitives for generated pack outputs.
- Built-in skills such as `migrate-claude`, `author-pack`, `check-pack`, `install-pack`, and `add-harness`.

`configport` owns:

- Installed/enabled pack state across harnesses.
- Profiles and scopes such as global, repository-local, project, or named user profiles.
- Local customization values for pack-declared options.
- Target-tool configuration files and enablement state.
- Secret references, not literal secret values.
- Model, tool, permission, and path choices that are user/machine configuration rather than pack source.
- Interactive configuration skills and automation commands.

Shared harness packages own facts that both products need, such as target config paths, plugin install locations, stable schema details, and native feature availability.

The pack repository owns:

- Pack content.
- Customization declarations and safe defaults.
- Pack-specific scripts.
- Pack-owned skills that are part of the user's generated packs.
- Source-level exception notes where the default tool behavior is not enough.
- Generated harness packages.
- Pack-specific documentation and source-level compatibility decisions.

Personal packs are still packs. The tools must not treat personal authorship, private distribution, or a pack name such as `writing-like-me` as a separate overlay category. The boundary is source versus configuration: reusable or personal behavior belongs in pack source; local machine values, selected-pack state, secrets, install scopes, and per-user answers belong in `configport` state.

The generic tools must not know about `Dhruv`, `ccconfigs`, local machine paths, private telemetry endpoints, or other pack-specific defaults.

## ccconfigs Role

`ccconfigs` should act as a real dogfood pack repository.

It should provide:

- Portable packs for essentials, writing, todoist, notifications, and experimental workflows.
- Pack-owned customization declarations such as writing voice preferences, Todoist settings, model roles, and optional endpoints.
- Dogfood configuration examples for `configport`, without making local values part of portable pack source.
- Generated output packages for Claude Code, OpenCode, and Codex.

## Authoring Format

Prefer Markdown-first authoring over YAML-first manifests.

The source shape should separate payload content from portable-pack contracts:

```text
packs/
  essentials/
    PACK.md
    skills/debugging/SKILL.md
    agents/senior-engineer-reviewer/
      AGENT.md
    commands/commit/
      COMMAND.md
      ASSET.md        # optional, only for non-obvious packaging facts
    hooks/notify/
      HOOK.md
      notify.ts
      ASSET.md        # optional, e.g. lifecycle/capability needs
  writing/
  todoist/
  notifications/
```

`packport` itself should also ship control skill source, separate from user pack payloads:

```text
packport/
  skills/
    migrate-claude/SKILL.md
    author-pack/SKILL.md
    check-pack/SKILL.md
    install-pack/SKILL.md
    add-harness/SKILL.md
```

`configport` should ship its own control skill source for configuration workflows, such as `configure-pack` or `configure-tools`.

The tool should use deterministic Markdown and directory conventions to build a lightweight index. Users and agents should mostly edit Markdown, not YAML.

## Payload And Contract Separation

Do not mix real payload content with tool control information.

There are two source artifact classes:

- Payload files: the agent-facing prompt, skill, command prose, hook script, or executable code.
- Optional asset contracts: pack-owned Markdown files that describe non-obvious packaging intent.

Payload files are opaque by default. The tool can copy them, wrap them, or transform target-native syntax, but it should not require hidden comments, special headings, or portable-pack frontmatter inside them.

Directory conventions infer identity, kind, and the standard payload file. `ASSET.md` exists only when the convention is not enough: capability needs, dependencies, customization, multiple payloads, nonstandard filenames, or source-level constraints.

Asset contracts can use small Markdown sections and lists because they are explicitly tool-facing source, not content the target agent should read as its capability instructions.

Example payload:

```md
# Commit

Inspect the current git changes. If the user explicitly asked for a commit, stage the relevant files and create it after reviewing the diff.

Never push, rewrite history, skip hooks, or discard work unless the user explicitly asks for that separate action.
```

Example optional asset contract:

```md
# Packaging Notes

## Needs

- Git read capability for status, diffs, and recent logs.
- Git write capability for staging files and creating commits.
- No network capability required.
- No history rewrite or destructive filesystem capability required.
```

Rules:

- Payload files must not contain portable-pack metadata.
- Asset contracts must not contain agent-facing instructions that are required for correct behavior.
- Tool-only or target-specific fields do not belong in payload frontmatter.
- Target-native frontmatter already required by a payload format is allowed, but it is treated as payload syntax, not as the portable contract.
- Templating is off by default. A placeholder-looking string such as `{{user_name}}` is literal text unless pack source explicitly opts that payload into templating.
- The lockfile records interpreted conventions and optional asset contracts that affect generation.
- Unknown structured contract keys should fail validation unless explicitly namespaced as experimental.
- Freeform contract prose is allowed only in named sections such as `Needs`, `Dependencies`, `Configuration`, `Source Constraints`, `Notes`, and `Experimental:<name>`.
- Pack-level metadata belongs in pack-level source, usually `PACK.md`, only when it truly applies to the whole pack.

This keeps the real content from playing two roles. A human can open the payload and see only capability content. A tool can open the asset contract and see only packaging metadata.

`PACK.md` should not become a giant manifest. The only required parser-facing fields should be name, version, and description. Other pack-level sections are optional and should stay readable Markdown:

- What the pack is for.
- Pack dependencies when needed.
- Pack-level customization options when needed.
- Export/discovery exceptions if the pack does not use default folder discovery.
- Source-level compatibility notes that apply to the whole pack.

Asset-specific responsibilities should live at the narrowest source scope:

- A command payload owns named user-invoked behavior.
- A workflow payload, if introduced, owns reusable procedural behavior that is not necessarily a named command.
- An agent payload owns its role instructions.
- A skill owns its own trigger description and references.
- A hook payload owns its behavior.
- A script owns its own execution behavior and environment expectations.
- Directory conventions own identity, kind, and standard payload paths.
- Optional `ASSET.md` contracts own non-obvious needs, dependencies, configuration declarations, nonstandard payload paths, and source-level constraints.

Target resolvers own the default mapping from those asset kinds to target harness outputs. Asset contracts should describe needs and constraints, not target mappings. Conversion decisions and accepted degradation belong in lockfile decisions, with reports generated from those decisions, unless they are true source-level portability assumptions.

The default should be convention-based discovery: asset directories contain standard payload files and may contain `ASSET.md` when the convention is not enough. `PACK.md` should only list individual assets when the default discovery rules are not enough.

## Structured Minimum

Keep schema small. Use structure only for facts the tool must know to find, name, install, or validate assets.

Core structure should stay close to:

- Pack name, version, and description.
- Asset identity, kind, and standard payload path inferred from directory conventions.
- Optional asset contract path.
- Pack dependencies when declared.
- Customization variables when declared by the pack.
- Compatibility constraints when an asset truly cannot support a target.
- Generated output ownership.

Contract prose should be limited to packaging intent, dependencies, capability needs, configuration declarations, and source-level portability constraints. Put capability behavior in payload files. Do not put target conversion instructions in payload content or default contract prose.

## Minimal Markdown Grammar

V1 should use the smallest parser surface that can support deterministic generation:

- Top-of-file `Key: Value` pairs before the first heading.
- Named Markdown sections such as `Needs`, `Dependencies`, `Configuration`, `Source Constraints`, `Notes`, and `Experimental:<name>`.
- Bullets under named sections preserved as prose unless a repeated pattern is promoted later.
- Unknown structured keys fail validation.
- Unknown prose headings warn unless they are namespaced as `Experimental:<name>`.
- `PACK.md` required keys: `Name`, `Version`, `Description`.
- `ASSET.md` has no required keys when conventions infer identity, kind, and payload path.

## Why Parse PACK.md And ASSET.md

`packport` should parse `PACK.md` and optional `ASSET.md` because these files are the source control plane. Payload files remain opaque.

The parser is needed to:

- Build a deterministic pack index without asking an LLM to reinterpret source on every run.
- Validate required pack identity and version before generating target output.
- Discover optional asset needs, dependencies, customization declarations, and source-level constraints.
- Resolve target plans from stable facts instead of freeform payload text.
- Produce `pack.lock.yaml` with stable source IDs, hashes, ownership, and accepted decisions.
- Fail fast on unknown structured keys while preserving named prose sections for humans and skills.

The parser should not:

- Parse payload files for portable-pack metadata.
- Infer agent behavior from payload prose.
- Treat arbitrary Markdown as schema.
- Decide target-specific rendering policy.

Skip IR in v1. Do not ask authors to write or understand an intermediate representation, and do not build one unless real usage proves the index is insufficient. A lightweight index plus lockfile is enough:

```text
pack id -> convention-discovered assets -> optional contracts -> payload paths -> needs/configuration
pack.lock.yaml -> generated outputs -> ownership/hashes/versions/accepted decisions
```

Anything deeper should be justified by repeated friction in real user journeys.

## Author Simplification Contract

Authors should not need to understand target harness internals to get useful native output.

The normal authoring loop should be:

```text
write payload content in Markdown or code
write or update optional ASSET.md only when packaging intent cannot be inferred
run a tool skill such as migrate-claude, author-pack, or check-pack
review generated native target output
accept, edit, or record a conversion decision outside the payload when the default is wrong
```

The tool should absorb harness-specific work by combining:

- Directory conventions.
- Built-in skills that gather input, explain issues, and repair source.
- Target resolvers that know how each harness works.
- Native emitters that serialize stable file formats.
- Validators that catch structural target mistakes.
- Lockfiles that record what was generated and which versions produced it.

This keeps the authoring surface simple without reducing native target fidelity.

This design intentionally uses the harness LLM as the shell and driver. The tool should raise success rate by giving the LLM good local context, examples, validation feedback, and deterministic write primitives, not by encoding every harness behavior as configuration.

Some structure is still required for reproducible generation:

- Pack identity.
- Asset identity.
- Asset kind.
- Payload paths.
- Dependencies.
- Customization keys where the pack needs user-provided values.
- Source-level portability constraints.

That structure can live in Markdown headings, tables, lists, and small key-value sections inside `PACK.md` and optional `ASSET.md`. Complex harness behavior should prefer clear language over prematurely rigid schema when the resolver can apply the rule correctly or report an issue. Keep payload language in payload files, and keep tool metadata out of those files.

## Determinism Boundary

AI should help author, migrate, classify, and repair pack content. The tool should not need a perfect schema to produce useful output.

Good flow:

```text
AI skill authors or edits payload files and optional asset contracts
tool discovers assets by convention and indexes optional contracts
tool validates required conventions
target resolver derives native target plans and reports issues
tool primitives write target package files using native emitters
tool validates generated output shape and drift
```

Bad flow:

```text
AI reads freeform source and reinvents target config on every install
```

Better distinction:

- First generation and migration may be LLM-assisted and exploratory.
- Incremental updates should preserve existing payload, contract, and generated output shape.
- Deterministic primitives should validate conventions, record generated files, and detect drift.
- Target resolvers should make deterministic harness decisions using conventions, optional contracts, and harness references. Skills handle resolver issues, user choices, and source repairs.

## Language-First Mappings

Do not model every hard harness concept as a deep schema up front.

Some areas are expensive to model exactly and change often across harnesses:

- Permission systems.
- Approval modes.
- Tool-specific arguments.
- Lifecycle hook semantics.
- Native versus compatibility-mode feature tradeoffs.
- Agent orchestration and subagent fan-out.
- Command/workflow invocation syntax and argument interpolation.
- Context loading, rules, memory, and instruction precedence.
- Model selection, reasoning effort, temperature, and provider-specific tuning.
- Skill discovery, implicit invocation, and trigger descriptions.
- MCP/tool dependency setup and degraded fallback behavior.
- Install scope, trust, project/global precedence, and compatibility fallbacks.
- Secret handling and environment placeholder differences.
- Observability, telemetry, notifications, and hook payloads.
- UI metadata such as colors, icons, display names, and discoverability hints.

For these areas, authoring should start with conventions and optional target-neutral asset contracts that describe packaging intent in simple language. Agent-facing behavior goes in payload files. Target resolvers should produce normal target plans from conventions, contracts, and harness references. Skills handle ambiguous decisions instead of hardcoding target rendering into payload content.

Example payload:

```md
# Commit

Inspect the current git changes. If the user explicitly asked for a commit, stage the relevant files and create it after reviewing the diff.

Never push, rewrite history, skip hooks, or discard work unless the user explicitly asks for that separate action.
```

Example asset contract:

```md
# Packaging Notes

## Needs

- Git read capability for status, diffs, and recent logs.
- Git write capability for staging files and creating commits.
- No network capability required.
- No history rewrite or destructive filesystem capability required.
```

Example generated conversion decision, outside source payload content:

```md
# Decision Report: essentials/commands/commit

- Claude Code: rendered as slash command with git-focused allowed tools.
- OpenCode: rendered as native command with native bash permission rules.
- Codex: rendered as skill because custom slash-command packaging is not equivalent.

Accepted degradation: Codex users invoke this as a skill instead of a slash command.
```

The tool can start with light parsing and validation around contracts, but native output remains the goal. Repeated conversion decisions should be promoted into default tool behavior once they are understood.

Authority rule:

- Source-level portability constraints live in `ASSET.md`.
- Target-specific accepted degradation lives in lockfile decisions; human-readable reports are generated from those decisions.
- A recurring degradation becomes tool default behavior when it applies generally to a target.
- A degradation is promoted back to source only when it is a true source-level portability constraint, not a target quirk.

## Prose-First Concepts

These concepts should remain Markdown or plain text in v1.

They should be encapsulated at the smallest useful scope. Do not place every note in `PACK.md`, and do not leak tool-only notes into payload content.

- Pack-wide policy belongs in `PACK.md`.
- Asset-specific packaging intent belongs in `ASSET.md`.
- Command behavior belongs in command payloads; workflow behavior belongs in workflow payloads only if workflows are introduced as a separate source kind.
- Agent-specific behavior belongs in that agent payload.
- Payload files should not carry harness-specific rendering notes. Conversion decisions belong in resolvers, harness references, and lockfile decisions; skills handle ambiguous decisions.

| Concept | Why It Is Hard To Map | V1 Treatment |
| --- | --- | --- |
| Permissions and approvals | Each harness uses different tools, sandboxing, approval prompts, command matching, and trust models. | Describe asset needs in the asset contract. Resolver produces native permission plans where supported and records degradation when it cannot. |
| Tool names and parameters | Tool names differ, some tools are MCP-backed, and some tools accept patterns or command prefixes. | Describe required capabilities and examples in optional contracts when conventions are not enough. Resolver uses harness references to map needs to native tools. |
| Commands versus skills | Claude and OpenCode support commands; Codex source commands often fit better as skills. | Author as a command when the source intent is named user invocation. Resolver chooses command or skill per target and records conversion decisions. |
| Agent orchestration | Subagents, worker agents, parallelism, task depth, and child-session UX differ heavily. | Describe orchestration intent in the contract. Resolver maps normal cases; skills handle ambiguous cases. |
| Hook lifecycle | Event names, payloads, timing, and command execution differ per harness. | Describe trigger intent and payload expectations in the contract; resolver plans native hooks and emitter serializes them. |
| Context and instruction precedence | Rule files, global/project scope, compatibility fallbacks, and external references differ. | Describe which instructions should always load versus lazy-load in the contract; resolver places files conservatively. |
| Model/provider tuning | Model IDs, reasoning settings, service tiers, and provider options change often. | Use plain roles like fast/strong/review in contracts; resolver maps roles through harness references/config. |
| MCP dependencies | Install, auth, env vars, enabled tools, and startup behavior differ per harness. | Describe dependency purpose and required env vars in the contract; resolver plans config and emitter serializes it. |
| Secrets and env | Placeholder syntax and secret stores differ. | Declare variable names and explain secret source; never write secret values. |
| Native versus compatibility mode | Compatibility reduces duplication but may lose native features. | Resolver defaults to native output; lockfile decisions record compatibility exceptions and accepted degradation. |

The promotion rule is deliberate: prose first, snippets second, structure last.

## Generation Modes

First generation and incremental updates are different workflows.

First generation can be more AI-assisted:

- Inspect a source marketplace or pack repository.
- Classify assets.
- Draft payload files and optional asset contracts.
- Record target-specific decisions through resolver outputs.
- Generate outputs.
- Ask for review where resolver issues are ambiguous.

Incremental updates should be more constrained:

- Preserve existing pack source and generated layout.
- Change only the requested payload or optional contract block.
- Re-run validation and drift checks.
- Avoid reclassifying unrelated assets unless the user asks.

This distinction lets migration use the harness as a smart driver without making every future update depend on broad reinterpretation.

## Skills As Driver

Skills are the primary user experience.

There are three kinds of skills:

- `packport` control skills live in the `packport` package. They drive authoring, migration, checking, installation, release, and harness support workflows for pack source and generated pack output.
- `configport` control skills live in the `configport` package. They drive profile, selected-pack, local-value, scope, and target-tool configuration workflows.
- Pack payload skills live in pack repositories. They are user-facing capabilities that get emitted into generated target packages.

Control skills are distributed through harness-native control plugins. Installing the `packport` control plugin gives the user pack authoring and generation workflows. Installing the `configport` control plugin gives the user configuration workflows.

The CLI should remain usable without skills for automation and tests, but it should not become the primary product surface.

The built-in tool skills should include:

- `migrate-claude`: migrate a Claude Code marketplace or plugin collection into portable pack source.
- `author-pack`: create or extend a portable pack.
- `check-pack`: validate conventions, lockfile state, generated outputs, and drift.
- `install-pack`: install selected generated pack outputs into a target harness scope.
- `add-harness`: help add a new harness adapter and compatibility matrix entry.

The built-in `configport` skills should include:

- `configure-pack`: answer pack-declared configuration questions and store profile/scope values.
- `configure-tools`: manage selected packs, models, permissions, install scopes, and target-tool config files.

Skills can:

- Inspect local context.
- Ask questions.
- Classify ambiguous content.
- Edit payload files and optional asset contracts.
- Decide which deterministic primitive to run.
- Summarize migration or validation findings.

Control skills should not contain target-rendering business logic. They gather context, ask questions, edit source, call primitives, and explain resolver/validator output.

Deterministic tool primitives should own:

- Parsing contracts.
- Building the pack index.
- Resolving target plans from contracts and tool-owned target references.
- Mechanical rendering from target plans.
- Drift checks.
- Install and uninstall changes.
- Static target checks.

Target resolvers should own what becomes what for normal cases. For hard or ambiguous mappings, resolvers should surface ambiguity back to the driving skill instead of making the emitter infer semantics from payload or freeform prose.

## migrate-claude

`migrate-claude` should be a generic tool skill, not a ccconfigs-only skill.

It should accept:

- A Claude marketplace repository.
- A local Claude plugin directory.
- A Claude marketplace URL or path.
- Existing `.claude-plugin` assets.

It should produce or guide toward:

- Portable Markdown pack source made of payload files plus optional asset contracts.
- Customization declarations.
- Configuration candidates for values that should not live in pack source.
- Generated Claude, OpenCode, and Codex outputs.
- Compatibility and degradation notes.

It should classify assets as:

- Pack candidate.
- Configuration candidate.
- Harness-specific.
- Unsupported or degraded.
- Unclear and requiring user decision.

It must not silently decide pack boundaries, public/private distribution, or source-versus-configuration placement when the answer is ambiguous. Personal packs are still packs; they are not migrated into a separate overlay category merely because they are personal.

## Target Resolvers

Target resolvers convert `PackIndex` plus tool-owned harness references into target-specific plans or explicit issues.

```ts
type TargetId = string
type DecisionSet = DecisionRecord[]

type TargetResolver = {
  target: TargetId
  resolve(index: PackIndex, references: HarnessReferenceSet, accepted: DecisionSet): ResolveResult
}

type ResolveResult =
  | {
      status: "ok"
      plan: TargetPlan
      decisions: DecisionRecord[]
      notices: ResolveNotice[]
    }
  | {
      status: "blocked"
      issues: ResolveIssue[]
      candidates: DecisionCandidate[]
      errors: ResolveError[]
    }
```

Resolvers own:

- Default conversions, such as source commands to Claude/OpenCode commands and Codex skills.
- Capability mapping from optional contracts to target-native permissions.
- Model-role mapping from contracts or customization to target model identifiers.
- Compatibility and degradation detection.
- Blocking issues and decision candidates that the driving skill must explain, repair, or ask the user to resolve.

Resolvers must not edit payload files, write generated files, or silently invent target policy from payload prose. A resolver either returns a complete plan or a blocked result; it must not return a partial plan with errors.

In an `ok` result, `decisions` are the accepted or deterministic decisions used to produce the plan. Candidate decisions only appear in a `blocked` result.

## Harness Emitters

Harness emitters are deterministic file placers and light normalizers. They should be thin.

An emitter handles only stable serialization:

```ts
type Emitter = {
  target: TargetId
  emit(plan: TargetPlan): GeneratedFile[]
}

type TargetValidator = {
  target: TargetId
  validate(files: GeneratedFile[]): ValidationResult
}

type Installer = {
  target: TargetId
  install(files: GeneratedFile[], scope: InstallScope): InstallResult
}
```

Emitters know target-specific facts:

- File locations.
- Config formats.
- Frontmatter fields.
- Native schema details required to serialize already-resolved target-native fields.
- Output path rules.

Emitters should not become a complete model of every harness. The emitter should:

- Consume a resolved target plan, not raw source contracts.
- Treat payload files as opaque unless a target-native syntax transform is explicitly required.
- Render target-native files mechanically.
- Fail only when required structural output is impossible.
- Never decide accepted degradation; that belongs to resolver output and lockfile decisions.

Skills are where migration intelligence lives.

## Harness References

Harness references are tool-owned, versioned target knowledge. They are not pack payload and not pack-specific metadata.

They should define:

- Supported target surfaces.
- Permission and approval mapping rules.
- Model role mappings.
- Config syntax and file locations.
- Validation rules.
- Known unsupported or degraded behavior.

Skills may read harness references when explaining or repairing a plan. Resolvers consume them deterministically. V1 can fold harness reference behavior into the tool version; split reference versions only if drift checks need that precision.

## Initial Harness Targets

Initial targets:

- Claude Code.
- OpenCode.
- Codex.

Claude Code adapter means the Claude resolver plus emitter produce Claude-native plugin assets.

OpenCode adapter means the OpenCode resolver plus emitter produce native OpenCode assets by default. OpenCode supports some Claude compatibility, but compatibility mode should be explicit. Do not emit both Claude-compatible and native OpenCode versions into the same target install scope.

Codex adapter means the Codex resolver plus emitter produce documented Codex surfaces such as skills, custom agents, MCP config, hooks/config where supported, and source commands as skills when needed.

## OpenCode Compatibility Rule

OpenCode can consume some Claude conventions, but portable packs should not duplicate context.

Rule:

```text
One logical asset gets one inclusion path per target scope.
```

For OpenCode:

- Prefer native OpenCode output when it improves permissions, agents, commands, config, model mapping, or install UX.
- Use Claude compatibility only as an explicit migration or fallback mode.
- Document feature loss when compatibility mode is selected.

No source-ID deduplication system is planned for v1. The target resolver owns logical inclusion and dedup decisions. The target validator catches duplicate output paths or conflicting generated files.

## Customization

Customization declarations are pack-owned. Customization values are configuration-tool-owned.

The pack repo decides which variables exist, what they mean, and which safe defaults apply. The configuration tool stores and applies the actual user, machine, profile, and scope-specific answers.

V1 should support:

- Pack-level declarations.
- Local answers stored by `configport` profile/scope outside reusable payload.
- Namespaced keys such as `commit.review_model` when a value is only meaningful to one asset.

Do not add scoped merging until repeated usage proves namespaced keys are insufficient. Avoid one global customization registry when the variable is only meaningful for one asset. `configport` can manage profiles and scopes without moving the variable definitions out of the pack.

Examples from ccconfigs might include:

- `user_name`.
- `writing_voice_enabled`.
- `otel_endpoint`.
- `todoist_project`.
- `preferred_review_model`.

`packport` only knows how to:

- Validate declared types.
- Substitute declared placeholder values in generated outputs where the pack explicitly opts a payload or wrapper into substitution.
- Refuse missing required values.

`configport` knows how to:

- Ask for declared values.
- Store local answers for declared variables only.
- Select packs per harness/profile/scope.
- Apply user and machine answers into target-native config files.
- Keep secret references outside pack source and generated payloads.

Secrets should be emitted as environment references, not literal secret values.

## Configuration Management

Configuration management is a separate tool, `configport`, in the same monorepo as `packport`.

Reasons:

- Pack conversion and configuration state are different products.
- `packport` should not own long-lived user or machine configuration state.
- `configport` should be usable even when no pack conversion is happening.
- Both tools still need shared harness facts, install locations, and schema references, so a shared monorepo is simpler than separate repositories at this stage.
- The interactive configuration experience belongs in `configport` control skills, because harness agents can ask questions, inspect local context, and explain tradeoffs better than a raw CLI prompt.

The boundary should be explicit:

- `packport` primitives discover and validate pack source.
- `packport` resolver/emitter primitives generate target packages.
- `packport` installer primitives apply generated pack output to harness-specific locations.
- `configport` primitives manage selected packs, profiles, local answers, tool config files, and install scopes.
- Each tool's control skills orchestrate that tool's primitives and own the conversational workflow.

`configport configure` can exist for automation, but the primary UX is a `configure-pack` or `configure-tools` control skill shipped by `configport`. `packport` may expose metadata that helps `configport`, but it should not grow into the configuration manager.

## Permissions

Permissions are a likely over-modeling trap.

V1 should prefer clear target-neutral asset needs over a comprehensive cross-harness permission schema. The asset contract should describe required and excluded capabilities. Target resolvers translate that intent into the closest native permission plan using harness references.

Example optional `ASSET.md` needs section for `commands/commit/COMMAND.md`:

```md
# Packaging Notes

## Needs

- Git read capability for `git status`, `git diff`, and `git log`.
- Git write capability for `git add` and `git commit`.
- No network capability required.
- No history rewrite, destructive filesystem, or hook-bypass capability required.
```

Harness references, not the payload source, explain how target resolvers should plan native permissions:

```md
# Harness Reference: Claude Code Permissions

Use read/search tools. Allow only the listed git inspection commands through Bash.

## Harness Reference: OpenCode Permissions

Deny edit permissions. Allow read, grep, glob, list, and bash only for the listed git inspection commands.

## Harness Reference: Codex Permissions

Prefer read-only sandbox. If exec rules are generated, allow prefixes for the listed git inspection commands and prompt or deny everything else.
```

Resolved target plans may contain target-native mechanisms when the mapping is straightforward:

- Claude Code may use `allowed-tools` entries such as `Bash(git diff:*)`.
- OpenCode may use `permission.bash` glob patterns and file permission keys.
- Codex may use Starlark `prefix_rule()` files, sandbox mode, approval policy, and filesystem profiles.

If a mapping is ambiguous, the resolver should return an issue or degradation candidate. The skill presents that to the user, and accepted decisions are recorded in the lockfile. Human-readable reports are renderings of lockfile decisions. The tool should not require a perfect generic permission model before it can be useful.

Possible later promotion path:

- Repeated Markdown permission patterns become reusable snippets.
- Reusable snippets become light structured fields.
- Only proven stable fields become core schema.

## Templates

Avoid template-heavy implementation.

Prefer structured rendering:

- JSON from objects.
- TOML from objects.
- Markdown from small deterministic render helpers.
- Frontmatter from a small serializer.

If a template engine becomes necessary, use it only for simple presentation templates. Business logic belongs in parser and resolver code; emitters serialize resolved plans.

## Implementation Language

Use Bun and TypeScript. When creating `/home/dhruv/Code/packport`, use the latest LTS/stable versions available at setup time.

Reasons:

- Current repo already uses Bun-oriented scripts.
- The monorepo can later split packages into separate repositories if release cadence or ownership diverges.
- It can be packaged as an executable.
- It avoids shell scripts as source implementation.

Project setup must include:

- `lint` command.
- `typecheck` command.
- `format` command.
- `test` command.
- Pre-commit hooks that run the relevant checks without skipping or weakening them.

Tooling choices should prefer current stable/LTS releases over pinning old versions. The exact lint/format/test libraries can be chosen during implementation, but the repo must start with working quality gates before feature code lands.

Harness hooks should invoke the packaged CLI or Bun entrypoint during development. Shell wrappers should not be source-of-truth implementation.

## Generated Outputs

Dogfood repositories such as `ccconfigs` may commit generated packages for installability and drift checks. Generic pack repositories should also support generated release artifacts without committing `dist/`.

Expected shape:

```text
dist/
  claude/
  opencode/
  codex/
```

Generated outputs must be marked as generated and checked for drift.

## pack.lock.yaml And Provenance

`pack.lock.yaml` is machine-owned bookkeeping, not author-facing configuration glue. YAML is acceptable here because the lockfile is generated provenance, not source authoring syntax.

The lockfile is the authority for generated ownership and accepted target decisions. Human-readable decision reports are renderings of lockfile decisions, not a second source of truth.

V1 `pack.lock.yaml` should answer:

- Which source packs were selected.
- Which source asset IDs, optional contracts, and payload paths produced which generated files.
- Which target harness and scope each file belongs to.
- Which generated files are tool-owned and safe to update or remove.
- Which customization profile was used, without storing secrets.
- Which tool version produced the output.
- Which pack versions were rendered.
- Which target-specific decision IDs were accepted for that generated output.
- Which source hashes and output hashes were used for drift detection.

Possible shape:

```text
pack.lock.yaml                    # machine-owned repo-level generation lock
dist/claude/pack.lock.yaml        # optional only for standalone package provenance
```

The repo-level `pack.lock.yaml` supports incremental updates and drift checks. A target lockfile is only needed when a generated package is published or installed standalone and needs embedded provenance.

`pack.lock.yaml` should be deterministic and regenerated by the tool. Users should not hand-edit it.

## Versioning

Versioning belongs to the pack repository, but the tool should propagate it consistently.

Versions to track:

- Tool version: version of the portable-pack executable.
- Pack format version: version of the authoring conventions the tool expects.
- Pack version: version of each pack such as `essentials` or `writing`.
- Generated package version: version written into target-native package metadata where supported.

Pack versions should be declared once in pack-level source using the minimal `PACK.md` metadata convention.

Version propagation rules:

- Claude output should receive the pack version in Claude plugin metadata.
- OpenCode output should receive the pack version in generated package provenance and any native metadata the target supports.
- Codex output should receive the pack version in plugin/package metadata where supported and always in `pack.lock.yaml`.
- Generated files should include a stable generated marker with source pack and version when the target format allows comments.
- Drift checks should fail if source pack versions and generated target package versions diverge.

The tool should not decide semantic version bumps. Skills can help suggest a bump, but the pack author chooses it. The tool validates consistency and propagates the selected version.

## Validation

The check flow should:

- Parse `PACK.md` files and optional asset contracts.
- Verify convention-inferred and declared payload paths exist without requiring portable-pack metadata inside payload files.
- Validate pack-declared customization metadata without resolving local configuration values.
- Build a lightweight pack index for asset identity, optional contract paths, payload paths, ownership, and simple fields.
- Read the existing `pack.lock.yaml` for ownership and accepted decisions.
- Resolve selected target plans using harness references and accepted decisions.
- Render selected targets from resolved target plans.
- Generate or update `pack.lock.yaml` and optional target package lockfiles.
- Run static target validators.
- Compare generated output and lockfiles against committed `dist/` when the repository commits generated packages.
- Verify pack versions propagate consistently to target metadata and `pack.lock.yaml`.
- Run representative behavioral or golden tests.

Validator output can be human-readable text with exit codes. Validation should focus on structural correctness and obvious target mistakes, not proving every prose instruction has a perfect cross-harness translation. Machine-readable output is not a v1 requirement.

## User Journey Acceptance Tests

These journeys are acceptance tests for the boundaries above, not a second copy of the architecture.

### Migrate A Claude Marketplace

- `migrate-claude` preserves reusable instructions as payload and writes optional `ASSET.md` only for non-obvious needs.
- Ambiguous pack boundaries, distribution intent, or source-versus-configuration placement become user questions, not automatic generic-tool defaults.
- Target-specific decisions are recorded as lockfile decisions; reports are generated views.

### Install packport Control Skills

- `packport` can generate a harness-native control plugin containing its built-in skills.
- The control plugin is separate from user pack plugins.
- Control skills call deterministic `packport` primitives; they do not reimplement parsing, resolving, emitting, or installing.

### Create A New Pack

- `author-pack` can create a payload-only asset when conventions infer everything.
- `check` reports where native output will be degraded until needs, dependencies, or configuration are declared.
- `PACK.md` stays pack-level and does not list assets discovered by convention.

### Install Into Claude Code

- The Claude resolver returns a target plan for the pack selection being generated and install scope.
- The Claude emitter serializes that plan without deciding command, permission, or degradation semantics.
- The lockfile records ownership, hashes, the pack selection used for generation, and accepted decisions.

### Install Into OpenCode

- The OpenCode resolver chooses one inclusion path per logical asset and target scope.
- Compatibility mode is explicit.
- The target validator catches output path conflicts; the emitter only serializes the resolved plan.

### Install Into Codex

- The Codex resolver maps source commands to skills when Codex lacks command packaging.
- Permission, sandbox, MCP, hook/config, and model choices come from resolver output.
- Degradation stays out of payload and optional `ASSET.md` unless it is a true source-level constraint.

### Configure Customization

- V1 supports pack-level declarations in pack source and local answers in `configport` state.
- Asset-specific values use namespaced keys until scoped merging is proven necessary.
- Payload templating requires explicit opt-in; otherwise placeholder-looking text is literal.
- Configuration state is managed by `configport` primitives and driven by `configport` control skills.

### Incremental Update

- Payload changes affect behavior; optional `ASSET.md` changes affect packaging intent.
- Unrelated assets are not reclassified.
- Drift checks detect manual generated-output edits before overwrite or removal.

### Add A Harness

- Adding a harness registers a target id, harness reference, resolver, emitter, validator, and installer as needed.
- Existing payload files do not change.
- Optional contract changes are required only for source-level constraints.

### Migrate ccconfigs

- Current Claude-first assets are migration input, not final portable source shape.
- Personal pack behavior remains pack source. Local machine values, secrets, selected-pack state, and install scopes move into `configport` state or pack-declared configuration values.
- Generated packages can be committed for dogfooding, but lockfiles define ownership and drift.

## Migration Strategy

Use a private beta branch for the big migration.

Do migration/scanner work before the first target adapter. The migrated source gives the Claude adapter real dogfood input instead of only hand-authored happy-path fixtures.

Plan:

1. Document current design.
2. Keep user journeys updated as implementation exposes design gaps.
3. Add Bun/TS tool skeleton with quality gates.
4. Add Markdown discovery, convention inference, and pack index.
5. Add validation and `pack.lock.yaml`/drift skeleton.
6. Add `packport` control skill source and a minimal control-plugin generator for at least one harness.
7. Add `migrate-claude` skill prototype and migration scanner.
8. Run scanner on `ccconfigs` and produce migrated source/report candidates without generated target output.
9. Add `configport` package skeleton, configuration primitives, and configuration control skill flow.
10. Add Claude resolver, emitter, validator, and installer using migrated source as adapter test input.
11. Add OpenCode resolver, emitter, validator, and installer.
12. Add Codex resolver, emitter, validator, and installer.
13. Generate committed `dist/<harness>` packages.
14. Beta test before merging to main.

## Review Workflow

Implementation should use atomic commits on the feature branch.

Preferences:

- Review every logical commit.
- Commit as we go.
- Iterate until reviewers approve before proceeding.

## Open Questions

- Whether `ASSET.md` optional contracts are sufficient before introducing any additional source files.
- Which prose-first patterns are common enough to promote into reusable snippets or light structure.
- Whether a lightweight pack index plus `pack.lock.yaml` is sufficient for incremental updates and drift checks.
- Whether generated `dist/` should be published directly from this repo or emitted as release artifacts later.
- What the minimum useful `migrate-claude` prototype should support first.
- Whether any Codex plugin surfaces need deeper research before adapter implementation.
