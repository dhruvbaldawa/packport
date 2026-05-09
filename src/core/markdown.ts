// ABOUTME: Parses packport's tiny Markdown control-plane grammar.
// ABOUTME: Preserves prose sections while validating structured keys and headings.

import type { ContractKind, Diagnostic, MarkdownDocument, MarkdownSection } from "./types";

const PACK_KEYS = new Set(["Description", "Name", "Version"]);
const ASSET_KEYS = new Set(["Payload", "Payloads", "Templated"]);
const PACK_REQUIRED_KEYS = ["Name", "Version", "Description"] as const;
const SECTION_NAMES = new Set([
  "Configuration",
  "Dependencies",
  "Needs",
  "Notes",
  "Source Constraints",
]);

/** Parses PACK.md or ASSET.md into structured keys, prose sections, and diagnostics. */
export function parseMarkdownContract(
  path: string,
  text: string,
  kind: ContractKind,
): MarkdownDocument {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const diagnostics: Diagnostic[] = [];
  const keys: Record<string, string> = {};
  let sectionStart = lines.findIndex((line) => line.startsWith("#"));

  if (sectionStart === -1) {
    sectionStart = lines.length;
  }

  const allowedKeys = kind === "pack" ? PACK_KEYS : ASSET_KEYS;
  const keyLines = lines.slice(0, sectionStart);

  for (const [index, line] of keyLines.entries()) {
    const trimmed = line.trim();

    if (trimmed === "") {
      continue;
    }

    const match = /^(?<key>[A-Z][A-Za-z ]*):\s*(?<value>.*)$/.exec(trimmed);

    if (!match?.groups) {
      diagnostics.push({
        code: "invalid-key-line",
        message: `Expected a Key: Value pair before the first heading on line ${index + 1}.`,
        path,
        severity: "error",
      });
      continue;
    }

    const key = match.groups.key;
    const value = match.groups.value;

    if (key === undefined || value === undefined) {
      diagnostics.push({
        code: "invalid-key-line",
        message: `Expected a complete Key: Value pair before the first heading on line ${index + 1}.`,
        path,
        severity: "error",
      });
      continue;
    }

    if (!allowedKeys.has(key)) {
      diagnostics.push({
        code: "unknown-key",
        message: `Unknown ${kind} key '${key}'.`,
        path,
        severity: "error",
      });
      continue;
    }

    if (keys[key] !== undefined) {
      diagnostics.push({
        code: "duplicate-key",
        message: `Duplicate ${kind} key '${key}'.`,
        path,
        severity: "error",
      });
      continue;
    }

    const trimmedValue = value.trim();
    keys[key] = trimmedValue;

    if (kind === "asset" && key === "Templated" && !["false", "true"].includes(trimmedValue)) {
      diagnostics.push({
        code: "invalid-templated-value",
        message: "Templated must be either 'true' or 'false'.",
        path,
        severity: "error",
      });
    }
  }

  if (kind === "pack") {
    for (const key of PACK_REQUIRED_KEYS) {
      if (!keys[key]) {
        diagnostics.push({
          code: "missing-pack-key",
          message: `PACK.md is missing required key '${key}'.`,
          path,
          severity: "error",
        });
      }
    }
  }

  const sections = parseSections(path, lines.slice(sectionStart), diagnostics);

  return { diagnostics, keys, path, sections };
}

/** Parses Markdown headings into named sections and records warnings for unknown headings. */
function parseSections(
  path: string,
  lines: string[],
  diagnostics: Diagnostic[],
): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let currentName: string | undefined;
  let currentBody: string[] = [];

  for (const line of lines) {
    const heading = /^##\s+(?<name>.+)$/.exec(line);

    if (heading?.groups) {
      pushSection(sections, currentName, currentBody);
      const name = heading.groups.name;

      if (name === undefined) {
        continue;
      }

      currentName = name.trim();
      currentBody = [];
      validateSectionName(path, currentName, diagnostics);
      continue;
    }

    if (currentName !== undefined) {
      currentBody.push(line);
    }
  }

  pushSection(sections, currentName, currentBody);
  return sections;
}

/** Appends a completed Markdown section if a heading has been seen. */
function pushSection(sections: MarkdownSection[], name: string | undefined, body: string[]): void {
  if (name === undefined) {
    return;
  }

  sections.push({ body: body.join("\n").trim(), name });
}

/** Warns when a prose heading is not part of packport's small accepted section set. */
function validateSectionName(path: string, name: string, diagnostics: Diagnostic[]): void {
  if (SECTION_NAMES.has(name) || name.startsWith("Experimental:")) {
    return;
  }

  diagnostics.push({
    code: "unknown-section",
    message: `Unknown Markdown section '${name}'.`,
    path,
    severity: "warning",
  });
}
