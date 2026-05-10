// ABOUTME: Parses packport's tiny Markdown control-plane grammar.
// ABOUTME: Preserves prose sections while validating frontmatter fields and headings.

import { parseDocument } from "yaml";
import type {
  ContractKind,
  Diagnostic,
  MarkdownDocument,
  MarkdownFieldValue,
  MarkdownSection,
} from "./types";

const PACK_FIELDS = new Set(["description", "name", "version"]);
const ASSET_FIELDS = new Set(["payload", "payloads"]);
const PACK_REQUIRED_FIELDS = ["name", "version", "description"] as const;
const SECTION_NAMES = new Set([
  "Configuration",
  "Dependencies",
  "Needs",
  "Notes",
  "Source Constraints",
]);

/** Parses PACK.md or ASSET.md into frontmatter fields, prose sections, and diagnostics. */
export function parseMarkdownContract(
  path: string,
  text: string,
  kind: ContractKind,
): MarkdownDocument {
  const diagnostics: Diagnostic[] = [];
  const { body, frontmatter } = splitFrontmatter(path, text, diagnostics);
  const keys =
    frontmatter === undefined ? {} : parseFrontmatterFields(path, frontmatter, kind, diagnostics);

  validateBodyFrontmatterBoundary(path, body, kind, diagnostics);

  if (kind === "pack") {
    for (const field of PACK_REQUIRED_FIELDS) {
      if (!keys[field]) {
        diagnostics.push({
          code: "missing-pack-field",
          message: `PACK.md frontmatter is missing required field '${field}'.`,
          path,
          severity: "error",
        });
      }
    }
  }

  const sections = parseSections(path, body.split("\n"), diagnostics);

  return { diagnostics, keys, path, sections };
}

/** Splits an optional top-of-file YAML frontmatter block from the Markdown body. */
function splitFrontmatter(
  path: string,
  text: string,
  diagnostics: Diagnostic[],
): { readonly body: string; readonly frontmatter?: string } {
  const normalized = text.replaceAll("\r\n", "\n");

  if (!normalized.startsWith("---\n")) {
    return { body: normalized };
  }

  const lines = normalized.split("\n");
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");

  if (closingIndex === -1) {
    diagnostics.push({
      code: "invalid-frontmatter",
      message: "YAML frontmatter must be closed with a --- line.",
      path,
      severity: "error",
    });
    return { body: normalized };
  }

  return {
    body: lines.slice(closingIndex + 1).join("\n"),
    frontmatter: lines.slice(1, closingIndex).join("\n"),
  };
}

/** Parses and validates the YAML frontmatter fields for one contract document. */
function parseFrontmatterFields(
  path: string,
  frontmatter: string,
  kind: ContractKind,
  diagnostics: Diagnostic[],
): Record<string, MarkdownFieldValue> {
  const document = parseDocument(frontmatter);
  const keys: Record<string, MarkdownFieldValue> = {};

  for (const error of document.errors) {
    diagnostics.push({
      code: "invalid-frontmatter",
      message: error.message,
      path,
      severity: "error",
    });
  }

  const parsed = document.toJSON();

  if (parsed === null) {
    return keys;
  }

  if (!isRecord(parsed)) {
    diagnostics.push({
      code: "invalid-frontmatter",
      message: "YAML frontmatter must contain a mapping.",
      path,
      severity: "error",
    });
    return keys;
  }

  const allowedFields = kind === "pack" ? PACK_FIELDS : ASSET_FIELDS;

  for (const [field, value] of Object.entries(parsed)) {
    if (!allowedFields.has(field)) {
      diagnostics.push({
        code: "unknown-field",
        message: `Unknown ${kind} frontmatter field '${field}'.`,
        path,
        severity: "error",
      });
      continue;
    }

    const normalized = normalizeFrontmatterValue(path, kind, field, value, diagnostics);

    if (normalized !== undefined) {
      keys[field] = normalized;
    }
  }

  return keys;
}

/** Converts supported frontmatter scalar and sequence values into the parser's key map. */
function normalizeFrontmatterValue(
  path: string,
  kind: ContractKind,
  field: string,
  value: unknown,
  diagnostics: Diagnostic[],
): MarkdownFieldValue | undefined {
  if (Array.isArray(value)) {
    if (kind !== "asset" || field !== "payloads") {
      diagnostics.push(invalidFieldValue(path, field, "must be a scalar value."));
      return undefined;
    }

    const entries: string[] = [];

    for (const entry of value) {
      if (!isScalarFrontmatterValue(entry)) {
        diagnostics.push(invalidFieldValue(path, field, "must contain only scalar values."));
        return undefined;
      }

      entries.push(String(entry).trim());
    }

    return entries;
  }

  if (!isScalarFrontmatterValue(value)) {
    diagnostics.push(invalidFieldValue(path, field, "must be a scalar value."));
    return undefined;
  }

  const normalizedValue = value === null ? "" : String(value).trim();

  return normalizedValue;
}

/** Reports likely legacy top-of-file fields that should now live in frontmatter. */
function validateBodyFrontmatterBoundary(
  path: string,
  body: string,
  kind: ContractKind,
  diagnostics: Diagnostic[],
): void {
  const lines = body.split("\n");
  const sectionStart = lines.findIndex((line) => line.startsWith("#"));
  const prefixLines = sectionStart === -1 ? lines : lines.slice(0, sectionStart);
  const allowedFields = kind === "pack" ? PACK_FIELDS : ASSET_FIELDS;
  const bodyFields = new Set([
    ...allowedFields,
    ...[...allowedFields].map((field) => titleCaseField(field)),
    ...(kind === "asset" ? ["templated", "Templated"] : []),
  ]);

  for (const line of prefixLines) {
    const match = /^(?<field>[A-Za-z][A-Za-z ]*):/.exec(line.trim());
    const field = match?.groups?.field;

    if (field === undefined || !bodyFields.has(field)) {
      continue;
    }

    diagnostics.push({
      code: "legacy-field-location",
      message: `${kind === "pack" ? "PACK.md" : "ASSET.md"} field '${field}' must be declared in YAML frontmatter.`,
      path,
      severity: "error",
    });
  }
}

/** Builds the legacy Title Case spelling for frontmatter-field diagnostics. */
function titleCaseField(field: string): string {
  return field
    .split(" ")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
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

/** Returns true for frontmatter values that packport can safely coerce to strings. */
function isScalarFrontmatterValue(value: unknown): value is boolean | number | string | null {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

/** Builds a consistent diagnostic for unsupported field value shapes. */
function invalidFieldValue(path: string, field: string, message: string): Diagnostic {
  return {
    code: "invalid-field-value",
    message: `Frontmatter field '${field}' ${message}`,
    path,
    severity: "error",
  };
}

/** Narrows parsed YAML values to plain records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
