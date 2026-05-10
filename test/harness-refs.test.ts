// ABOUTME: Verifies target-specific rendering of explicit portable refs.
// ABOUTME: Keeps reusable tool and MCP aliases deterministic before configport applies output.

import { describe, expect, test } from "bun:test";
import {
  KNOWN_PORTABLE_MCP_REFS,
  KNOWN_PORTABLE_TOOL_REFS,
  renderPortableRefsForTarget,
  validateKnownPortableRefs,
  type HarnessTarget,
} from "../src/core/harness-refs";
import { scanPortableRefs } from "../src/core/refs";

describe("harness portable refs", () => {
  const harnessTargets: readonly HarnessTarget[] = ["claude", "codex", "opencode"];

  test("renders config, tool, and MCP refs for a target", () => {
    const path = "packs/essentials/instructions/review/INSTRUCTION.md";
    const text =
      "Use {{tool.git.read}}, write in {{config.review_voice}}, and consult {{mcp.todoist}}.";
    const scanned = scanPortableRefs(path, text);

    const result = renderPortableRefsForTarget(text, scanned.refs, "codex", {
      review_voice: "direct reviewer prose",
    });

    expect(scanned.diagnostics).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.text).toBe(
      "Use Codex shell access for git status, diff, and log commands, write in direct reviewer prose, and consult the Todoist MCP server configured for Codex.",
    );
  });

  test("renders the same aliases with target-specific wording", () => {
    const path = "packs/essentials/instructions/review/INSTRUCTION.md";
    const text = "Use {{tool.fs.write}} and {{tool.shell.git}}.";
    const scanned = scanPortableRefs(path, text);

    const claude = renderPortableRefsForTarget(text, scanned.refs, "claude");
    const opencode = renderPortableRefsForTarget(text, scanned.refs, "opencode");

    expect(claude.diagnostics).toEqual([]);
    expect(opencode.diagnostics).toEqual([]);
    expect(claude.text).toBe(
      "Use Claude Code edit and write tools and Claude Code Bash commands limited to git-prefixed operations.",
    );
    expect(opencode.text).toBe(
      "Use OpenCode file edit/write permissions and OpenCode bash permission rules limited to git-prefixed commands.",
    );
  });

  test("renders every known tool and MCP alias for every target", () => {
    for (const target of harnessTargets) {
      for (const toolRef of KNOWN_PORTABLE_TOOL_REFS) {
        const text = `Use {{tool.${toolRef}}}.`;
        const scanned = scanPortableRefs(
          "packs/essentials/instructions/review/INSTRUCTION.md",
          text,
        );
        const result = renderPortableRefsForTarget(text, scanned.refs, target);

        expect(scanned.diagnostics).toEqual([]);
        expect(validateKnownPortableRefs(scanned.refs)).toEqual([]);
        expect(result.diagnostics).toEqual([]);
        expect(result.text).not.toContain("{{");
      }

      for (const mcpRef of KNOWN_PORTABLE_MCP_REFS) {
        const text = `Use {{mcp.${mcpRef}}}.`;
        const scanned = scanPortableRefs(
          "packs/essentials/instructions/review/INSTRUCTION.md",
          text,
        );
        const result = renderPortableRefsForTarget(text, scanned.refs, target);

        expect(scanned.diagnostics).toEqual([]);
        expect(validateKnownPortableRefs(scanned.refs)).toEqual([]);
        expect(result.diagnostics).toEqual([]);
        expect(result.text).not.toContain("{{");
      }
    }
  });

  test("reports missing config answers without hiding the unresolved ref", () => {
    const path = "packs/essentials/instructions/review/INSTRUCTION.md";
    const text = "Write in {{config.review_voice}}.";
    const scanned = scanPortableRefs(path, text);

    const result = renderPortableRefsForTarget(text, scanned.refs, "opencode");

    expect(result.text).toBe(text);
    expect(result.diagnostics).toEqual([
      {
        code: "unresolved-config-ref",
        message: "Portable config ref '{{config.review_voice}}' has no configured value.",
        path,
        severity: "error",
      },
    ]);
  });

  test("does not render portable refs introduced by config answers", () => {
    const path = "packs/essentials/instructions/review/INSTRUCTION.md";
    const text = "Use {{tool.git.read}}. Write in {{config.review_voice}}.";
    const scanned = scanPortableRefs(path, text);

    const result = renderPortableRefsForTarget(text, scanned.refs, "claude", {
      review_voice: "{{tool.git.read}}",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.text).toBe(
      "Use Claude Code read tools plus Bash git status, diff, and log commands. Write in {{tool.git.read}}.",
    );
  });

  test("reports unknown tool and MCP aliases", () => {
    const path = "packs/essentials/instructions/review/INSTRUCTION.md";
    const text = "Use {{tool.shell.rsync}} and {{mcp.calendar}}.";
    const scanned = scanPortableRefs(path, text);

    expect(validateKnownPortableRefs(scanned.refs)).toEqual([
      {
        code: "unknown-portable-ref-alias",
        message: "Portable tool ref '{{tool.shell.rsync}}' is not in the built-in alias map.",
        path,
        severity: "error",
      },
      {
        code: "unknown-portable-ref-alias",
        message: "Portable mcp ref '{{mcp.calendar}}' is not in the built-in alias map.",
        path,
        severity: "error",
      },
    ]);
  });
});
