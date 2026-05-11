// ABOUTME: Scans explicit portable refs without interpreting payload prose.
// ABOUTME: Keeps config/tool/MCP references small, declared, and non-template-like.

import type { Diagnostic, PortableRef, PortableRefNamespace } from "./types";

const PORTABLE_REF_PATTERN = /(?<!\{)\{\{(?<body>[^{}]*)\}\}(?!\})/g;
const TARGET_NATIVE_PLACEHOLDER_PATTERN = /\{\{(?:ARGS|arg)\}\}|\$\{\{\{ARGS\}\}\}/g;
const VALID_NAMESPACES = new Set<PortableRefNamespace>(["config", "mcp", "tool"]);
const REF_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/;

export type ScanPortableRefsOptions = {
  readonly ignoreTargetNativePlaceholders?: boolean;
};

/** Scans text for explicit portable refs and reports unsupported template-like syntax. */
export function scanPortableRefs(
  path: string,
  text: string,
  options: ScanPortableRefsOptions = {},
): {
  readonly diagnostics: readonly Diagnostic[];
  readonly refs: readonly PortableRef[];
} {
  const diagnostics: Diagnostic[] = [];
  const refs: PortableRef[] = [];
  const ignoredRanges: TextRange[] = [];

  if (options.ignoreTargetNativePlaceholders) {
    for (const match of text.matchAll(TARGET_NATIVE_PLACEHOLDER_PATTERN)) {
      ignoredRanges.push({ end: match.index + match[0].length, start: match.index });
    }
  }

  for (const match of text.matchAll(PORTABLE_REF_PATTERN)) {
    const raw = match[0];
    const body = match.groups?.body;
    const start = match.index;

    if (isIgnoredIndex(start, ignoredRanges)) {
      continue;
    }

    if (body === undefined) {
      continue;
    }

    const ref = parsePortableRef(path, raw, body, start, diagnostics);

    if (ref) {
      refs.push(ref);
    }
  }

  validateBalancedPortableRefDelimiters(path, text, ignoredRanges, diagnostics);

  return { diagnostics, refs };
}

/** Creates a stable key for comparing declarations and payload refs. */
export function portableRefKey(ref: Pick<PortableRef, "name" | "namespace">): string {
  return `${ref.namespace}.${ref.name}`;
}

/** Parses the content inside one {{...}} token. */
function parsePortableRef(
  path: string,
  raw: string,
  body: string,
  start: number,
  diagnostics: Diagnostic[],
): PortableRef | undefined {
  if (body.trim() !== body || body.includes("|") || /\s/.test(body)) {
    diagnostics.push(invalidPortableRef(path, raw));
    return undefined;
  }

  const [namespace, ...nameParts] = body.split(".");

  if (
    namespace === undefined ||
    nameParts.length === 0 ||
    !VALID_NAMESPACES.has(namespace as PortableRefNamespace)
  ) {
    diagnostics.push({
      code: "unknown-portable-ref-namespace",
      message: `Portable ref '${raw}' must use one of: config, mcp, tool.`,
      path,
      severity: "error",
    });
    return undefined;
  }

  const name = nameParts.join(".");

  if (!REF_NAME_PATTERN.test(name)) {
    diagnostics.push(invalidPortableRef(path, raw));
    return undefined;
  }

  return {
    end: start + raw.length,
    name,
    namespace: namespace as PortableRefNamespace,
    path,
    raw,
    start,
  };
}

type TextRange = {
  readonly end: number;
  readonly start: number;
};

/** Reports dangling or triple-brace portable-ref delimiters outside known target-native syntax. */
function validateBalancedPortableRefDelimiters(
  path: string,
  text: string,
  ignoredRanges: readonly TextRange[],
  diagnostics: Diagnostic[],
): void {
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("{{", cursor);

    if (start === -1) {
      return;
    }

    if (isIgnoredIndex(start, ignoredRanges)) {
      cursor = start + 2;
      continue;
    }

    const end = text.indexOf("}}", start + 2);

    if (end === -1) {
      diagnostics.push({
        code: "invalid-portable-ref",
        message: "Portable ref is missing a closing }} delimiter.",
        path,
        severity: "error",
      });
      return;
    }

    if (text[start - 1] === "{" || text[end + 2] === "}") {
      diagnostics.push(invalidPortableRef(path, text.slice(start, end + 2)));
    }

    cursor = end + 2;
  }
}

/** Returns true when an index falls inside an ignored target-native placeholder range. */
function isIgnoredIndex(index: number, ranges: readonly TextRange[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

/** Builds a diagnostic for template-like or malformed refs. */
function invalidPortableRef(path: string, raw: string): Diagnostic {
  return {
    code: "invalid-portable-ref",
    message: `Portable ref '${raw}' must be a simple config.*, mcp.*, or tool.* reference.`,
    path,
    severity: "error",
  };
}
