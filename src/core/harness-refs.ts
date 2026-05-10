// ABOUTME: Renders explicit portable refs through a small built-in harness alias map.
// ABOUTME: Keeps tool and MCP names reusable without introducing a template engine.

import type { Diagnostic, PortableRef, PortableRefNamespace } from "./types";

export type HarnessTarget = "claude" | "codex" | "opencode";

export const KNOWN_PORTABLE_MCP_REFS = ["todoist"] as const;

export const KNOWN_PORTABLE_TOOL_REFS = [
  "fs.read",
  "fs.write",
  "git.read",
  "git.write",
  "shell.git",
] as const;

export type PortableRefRenderResult = {
  readonly diagnostics: readonly Diagnostic[];
  readonly text: string;
};

const TARGET_TOOL_PROSE: Record<HarnessTarget, Record<string, string>> = {
  claude: {
    "fs.read": "Claude Code read, glob, and grep tools",
    "fs.write": "Claude Code edit and write tools",
    "git.read": "Claude Code read tools plus Bash git status, diff, and log commands",
    "git.write": "Claude Code Bash git add and git commit commands",
    "shell.git": "Claude Code Bash commands limited to git-prefixed operations",
  },
  codex: {
    "fs.read": "Codex filesystem read access in the selected sandbox",
    "fs.write": "Codex filesystem write access in the selected sandbox",
    "git.read": "Codex shell access for git status, diff, and log commands",
    "git.write": "Codex shell access for git add and git commit commands",
    "shell.git": "Codex shell prefix rules for git commands",
  },
  opencode: {
    "fs.read": "OpenCode file read, grep, glob, and list permissions",
    "fs.write": "OpenCode file edit/write permissions",
    "git.read": "OpenCode bash permissions for git status, diff, and log commands",
    "git.write": "OpenCode bash permissions for git add and git commit commands",
    "shell.git": "OpenCode bash permission rules limited to git-prefixed commands",
  },
};

const TARGET_MCP_PROSE: Record<HarnessTarget, Record<string, string>> = {
  claude: {
    todoist: "the Todoist MCP server configured for Claude Code",
  },
  codex: {
    todoist: "the Todoist MCP server configured for Codex",
  },
  opencode: {
    todoist: "the Todoist MCP server configured for OpenCode",
  },
};

const KNOWN_MCP_REFS = new Set<string>(KNOWN_PORTABLE_MCP_REFS);
const KNOWN_TOOL_REFS = new Set<string>(KNOWN_PORTABLE_TOOL_REFS);

/** Validates tool and MCP refs against the built-in starter alias map. */
export function validateKnownPortableRefs(refs: readonly PortableRef[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    const key = `${ref.path}:${ref.namespace}.${ref.name}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    if (ref.namespace === "tool" && !KNOWN_TOOL_REFS.has(ref.name)) {
      diagnostics.push(unknownAliasDiagnostic(ref, "tool"));
    }

    if (ref.namespace === "mcp" && !KNOWN_MCP_REFS.has(ref.name)) {
      diagnostics.push(unknownAliasDiagnostic(ref, "mcp"));
    }
  }

  return diagnostics;
}

/** Renders explicit portable refs for a target using config answers and built-in aliases. */
export function renderPortableRefsForTarget(
  text: string,
  refs: readonly PortableRef[],
  target: HarnessTarget,
  configAnswers: Readonly<Record<string, string>> = {},
): PortableRefRenderResult {
  const diagnostics: Diagnostic[] = [];
  let cursor = 0;
  let rendered = "";

  for (const ref of [...refs].sort((left, right) => left.start - right.start)) {
    if (!isRefSpanInText(text, ref) || ref.start < cursor) {
      continue;
    }

    rendered += text.slice(cursor, ref.start);
    const replacement = renderPortableRef(ref, target, configAnswers, diagnostics);

    rendered += replacement ?? ref.raw;
    cursor = ref.end;
  }

  rendered += text.slice(cursor);

  return { diagnostics, text: rendered };
}

/** Renders one ref or records why it cannot be rendered yet. */
function renderPortableRef(
  ref: PortableRef,
  target: HarnessTarget,
  configAnswers: Readonly<Record<string, string>>,
  diagnostics: Diagnostic[],
): string | undefined {
  if (ref.namespace === "config") {
    const answer = configAnswers[ref.name];

    if (answer === undefined) {
      diagnostics.push({
        code: "unresolved-config-ref",
        message: `Portable config ref '${ref.raw}' has no configured value.`,
        path: ref.path,
        severity: "error",
      });
      return undefined;
    }

    return answer;
  }

  const targetAliases =
    ref.namespace === "tool" ? TARGET_TOOL_PROSE[target] : TARGET_MCP_PROSE[target];
  const rendered = targetAliases[ref.name];

  if (rendered === undefined) {
    diagnostics.push(unknownAliasDiagnostic(ref, ref.namespace));
    return undefined;
  }

  return rendered;
}

/** Builds a diagnostic for a ref name outside the starter alias map. */
function unknownAliasDiagnostic(
  ref: PortableRef,
  namespace: Exclude<PortableRefNamespace, "config">,
): Diagnostic {
  return {
    code: "unknown-portable-ref-alias",
    message: `Portable ${namespace} ref '${ref.raw}' is not in the built-in alias map.`,
    path: ref.path,
    severity: "error",
  };
}

/** Confirms a caller-provided ref still points at the original source token. */
function isRefSpanInText(text: string, ref: PortableRef): boolean {
  return text.slice(ref.start, ref.end) === ref.raw;
}
