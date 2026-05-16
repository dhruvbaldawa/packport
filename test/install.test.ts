// ABOUTME: Verifies packport install writes target-tool global config from generated output.
// ABOUTME: Uses temporary homes so install behavior is exercised without touching user config.

import { lstat, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { installPackRepository } from "../src/core/install";
import { writeConfigportInstructionSelection } from "../src/core/configport";

describe("installPackRepository", () => {
  test("installs generated output into Codex, Claude, and OpenCode homes", async () => {
    const rootPath = await createInstallPackRepository();
    const codexHomePath = await createTempDirectory("packport-install-codex-");
    const agentsRootPath = await createTempDirectory("packport-install-agents-");
    const claudeHomePath = await createTempDirectory("packport-install-claude-");
    const opencodeConfigRootPath = await createTempDirectory("packport-install-opencode-");

    const result = await installPackRepository(rootPath, {
      agentsRootPath,
      claudeHomePath,
      codexHomePath,
      opencodeConfigRootPath,
    });

    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
    expect(result.dryRun).toBe(false);

    const codexMarketplace = JSON.parse(
      await readFile(join(agentsRootPath, ".agents/plugins/marketplace.json"), "utf8"),
    );
    expect(codexMarketplace.plugins.map((plugin: { name: string }) => plugin.name)).toEqual([
      "essentials",
    ]);
    expect(codexMarketplace.plugins[0].source).toEqual({
      path: join(rootPath, ".packs/codex/essentials"),
      source: "local",
    });

    const codexConfig = await readFile(join(codexHomePath, "config.toml"), "utf8");
    expect(codexConfig).toContain("# packport-managed-codex-plugins:start");
    expect(codexConfig).toContain('[plugins."essentials@packport-local"]');
    expect(codexConfig).toContain("# packport-managed-codex-mcp:start");
    expect(codexConfig).toContain('[mcp_servers."docs"]');

    expect(await readFile(join(codexHomePath, "AGENTS.md"), "utf8")).toContain(
      "Codex user guidance.",
    );
    expect(await readFile(join(rootPath, "AGENTS.md"), "utf8")).toContain(
      "Codex project guidance.",
    );

    const claudeSettings = JSON.parse(
      await readFile(join(claudeHomePath, "settings.json"), "utf8"),
    );
    expect(claudeSettings.extraKnownMarketplaces["packport-local"]).toEqual({
      source: { path: rootPath, source: "directory" },
    });
    expect(claudeSettings.enabledPlugins["essentials@packport-local"]).toBe(true);
    expect(await readFile(join(claudeHomePath, "CLAUDE.md"), "utf8")).toContain(
      "Claude user guidance.",
    );

    const opencodeConfig = JSON.parse(
      await readFile(join(opencodeConfigRootPath, "opencode.json"), "utf8"),
    );
    expect(opencodeConfig.instructions).toEqual([join(opencodeConfigRootPath, "AGENTS.md")]);
    expect(opencodeConfig.mcp.docs).toEqual({
      headers: { Authorization: "Bearer {env:DOCS_TOKEN}" },
      type: "remote",
      url: "https://example.com/mcp",
    });
    expect(await readFile(join(opencodeConfigRootPath, "commands/plan.md"), "utf8")).toContain(
      "Use OpenCode bash permissions",
    );
    expect(await readFile(join(opencodeConfigRootPath, "agents/reviewer.md"), "utf8")).toContain(
      "OpenCode file read",
    );
    expect(
      await readFile(join(opencodeConfigRootPath, "skills/debugging/SKILL.md"), "utf8"),
    ).toContain("OpenCode");
    expect(await readFile(join(opencodeConfigRootPath, "AGENTS.md"), "utf8")).toContain(
      "OpenCode user guidance.",
    );
  });

  test("dry-run reports planned writes without writing tool homes", async () => {
    const rootPath = await createInstallPackRepository();
    const codexHomePath = await createTempDirectory("packport-install-codex-");
    const agentsRootPath = await createTempDirectory("packport-install-agents-");
    await runCli([
      "generate",
      rootPath,
      "--target",
      "codex",
      "--target",
      "claude",
      "--target",
      "opencode",
      "--no-configport",
    ]);

    const result = await runCli([
      "install",
      rootPath,
      "--target",
      "codex",
      "--dry-run",
      "--codex-home",
      codexHomePath,
      "--agents-root",
      agentsRootPath,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Would install codex output");
    expect(result.stdout).toContain("Would write Install Codex config");
    await expect(lstat(join(codexHomePath, "config.toml"))).rejects.toThrow();
    await expect(lstat(join(agentsRootPath, ".agents/plugins/marketplace.json"))).rejects.toThrow();
  });

  test("allows existing install symlinks that resolve into the source repo", async () => {
    const rootPath = await createInstallPackRepository();
    const claudeHomePath = await createTempDirectory("packport-install-claude-");
    const opencodeConfigRootPath = await createTempDirectory("packport-install-opencode-");
    const linkedSettingsPath = join(rootPath, "config/settings.json");
    const linkedSkillPath = join(rootPath, "linked-opencode-skills/debugging");

    await mkdir(dirname(linkedSettingsPath), { recursive: true });
    await writeFile(linkedSettingsPath, "{}\n");
    await symlink(linkedSettingsPath, join(claudeHomePath, "settings.json"));
    await mkdir(linkedSkillPath, { recursive: true });
    await mkdir(join(opencodeConfigRootPath, "skills"), { recursive: true });
    await symlink(linkedSkillPath, join(opencodeConfigRootPath, "skills/debugging"));

    const result = await installPackRepository(rootPath, {
      claudeHomePath,
      opencodeConfigRootPath,
      targets: ["claude", "opencode"],
    });

    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
    expect(await readFile(linkedSettingsPath, "utf8")).toContain("essentials@packport-local");
    expect(await readFile(join(linkedSkillPath, "SKILL.md"), "utf8")).toContain("OpenCode");
  });

  test("reports usage errors for invalid install options", async () => {
    const invalidTarget = await runCli(["install", "--target", "bad"]);
    const missingPath = await runCli(["install", "--codex-home"]);

    expect(invalidTarget.exitCode).toBe(1);
    expect(invalidTarget.stderr).toContain("--target requires claude, opencode, or codex.");
    expect(missingPath.exitCode).toBe(1);
    expect(missingPath.stderr).toContain("--codex-home requires a path.");
  });
});

async function createInstallPackRepository(): Promise<string> {
  const rootPath = await createTempDirectory("packport-install-root-");
  const docsTokenPlaceholder = "$" + "{DOCS_TOKEN}";
  await writeFileTree(rootPath, {
    "packs/essentials/.mcp.json": JSON.stringify({
      mcpServers: {
        docs: {
          headers: { Authorization: `Bearer ${docsTokenPlaceholder}` },
          type: "sse",
          url: "https://example.com/mcp",
        },
      },
    }),
    "packs/essentials/PACK.md": `---
name: Essentials
version: 1.2.3
description: Core workflows.
---

# Essentials

## Needs

- {{mcp.todoist}} for task context.
- {{tool.fs.read}} for file review.
- {{tool.git.read}} for repository inspection.
`,
    "packs/essentials/agents/reviewer/AGENT.md": "Review with {{tool.fs.read}}.\n",
    "packs/essentials/commands/plan/COMMAND.md": `---
description: Plan implementation
---

Use {{tool.git.read}}.
`,
    "packs/essentials/instructions/claude-user/INSTRUCTION.md": "Claude user guidance.\n",
    "packs/essentials/instructions/codex-project/INSTRUCTION.md": "Codex project guidance.\n",
    "packs/essentials/instructions/codex-user/INSTRUCTION.md": "Codex user guidance.\n",
    "packs/essentials/instructions/opencode-user/INSTRUCTION.md": "OpenCode user guidance.\n",
    "packs/essentials/skills/debugging/SKILL.md": "# Debugging\n\nUse {{tool.fs.read}}.\n",
  });

  await writeConfigportInstructionSelection(join(rootPath, ".configport"), {
    answers: {},
    instructions: ["codex-project"],
    pack: "essentials",
    profile: "personal",
    scope: "project",
    target: "codex",
  });
  await writeConfigportInstructionSelection(join(rootPath, ".configport"), {
    answers: {},
    instructions: ["codex-user"],
    pack: "essentials",
    profile: "personal",
    scope: "user",
    target: "codex",
  });
  await writeConfigportInstructionSelection(join(rootPath, ".configport"), {
    answers: {},
    instructions: ["claude-user"],
    pack: "essentials",
    profile: "personal",
    scope: "user",
    target: "claude",
  });
  await writeConfigportInstructionSelection(join(rootPath, ".configport"), {
    answers: {},
    instructions: ["opencode-user"],
    pack: "essentials",
    profile: "personal",
    scope: "user",
    target: "opencode",
  });

  return resolve(rootPath);
}

async function createTempDirectory(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function writeFileTree(rootPath: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const targetPath = join(rootPath, path);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
  }
}
