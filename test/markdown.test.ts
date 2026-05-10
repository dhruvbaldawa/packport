// ABOUTME: Verifies packport's minimal Markdown control-plane parser.
// ABOUTME: Protects the PACK.md and ASSET.md grammar from accidental schema growth.

import { describe, expect, test } from "bun:test";
import { parseMarkdownContract } from "../src/core/markdown";

describe("parseMarkdownContract", () => {
  test("parses required PACK.md frontmatter fields and named sections", () => {
    const document = parseMarkdownContract(
      "packs/essentials/PACK.md",
      `---
name: Essentials
version: 1.2.3
description: Core agent workflows.
---

# Essentials

## Dependencies

- git
`,
      "pack",
    );

    expect(document.diagnostics).toEqual([]);
    expect(document.keys).toEqual({
      description: "Core agent workflows.",
      name: "Essentials",
      version: "1.2.3",
    });
    expect(document.sections).toEqual([{ body: "- git", name: "Dependencies" }]);
  });

  test("reports missing required PACK.md frontmatter fields", () => {
    const document = parseMarkdownContract(
      "packs/essentials/PACK.md",
      `---
name: Essentials
---
`,
      "pack",
    );

    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "missing-pack-field",
      "missing-pack-field",
    ]);
  });

  test("rejects unknown structured frontmatter fields", () => {
    const document = parseMarkdownContract(
      "packs/essentials/PACK.md",
      `---
name: Essentials
version: 1.2.3
description: Core agent workflows.
owner: Dhruv
---
`,
      "pack",
    );

    expect(document.diagnostics).toContainEqual({
      code: "unknown-field",
      message: "Unknown pack frontmatter field 'owner'.",
      path: "packs/essentials/PACK.md",
      severity: "error",
    });
  });

  test("rejects duplicate structured frontmatter fields", () => {
    const document = parseMarkdownContract(
      "packs/essentials/PACK.md",
      `---
name: Essentials
name: Duplicate
version: 1.2.3
description: Core agent workflows.
---
`,
      "pack",
    );

    expect(
      document.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "invalid-frontmatter" &&
          diagnostic.message.includes("Map keys must be unique"),
      ),
    ).toBe(true);
  });

  test("rejects legacy structured fields outside frontmatter", () => {
    const document = parseMarkdownContract(
      "packs/essentials/PACK.md",
      "Name: Essentials\n",
      "pack",
    );

    expect(document.diagnostics).toContainEqual({
      code: "legacy-field-location",
      message: "PACK.md field 'Name' must be declared in YAML frontmatter.",
      path: "packs/essentials/PACK.md",
      severity: "error",
    });
  });

  test("rejects lowercase structured fields outside frontmatter", () => {
    const document = parseMarkdownContract(
      "packs/essentials/commands/commit/ASSET.md",
      "payload: README.md\n",
      "asset",
    );

    expect(document.diagnostics).toContainEqual({
      code: "legacy-field-location",
      message: "ASSET.md field 'payload' must be declared in YAML frontmatter.",
      path: "packs/essentials/commands/commit/ASSET.md",
      severity: "error",
    });
  });

  test("validates templated values", () => {
    const document = parseMarkdownContract(
      "packs/essentials/commands/commit/ASSET.md",
      `---
templated: maybe
---
`,
      "asset",
    );

    expect(document.diagnostics).toEqual([
      {
        code: "invalid-templated-value",
        message: "templated must be either true or false.",
        path: "packs/essentials/commands/commit/ASSET.md",
        severity: "error",
      },
    ]);
  });

  test("accepts boolean templated values", () => {
    const trueDocument = parseMarkdownContract(
      "packs/essentials/commands/commit/ASSET.md",
      `---
templated: true
---
`,
      "asset",
    );
    const falseDocument = parseMarkdownContract(
      "packs/essentials/commands/commit/ASSET.md",
      `---
templated: false
---
`,
      "asset",
    );

    expect(trueDocument.diagnostics).toEqual([]);
    expect(falseDocument.diagnostics).toEqual([]);
  });

  test("warns on unknown prose headings", () => {
    const document = parseMarkdownContract(
      "packs/essentials/commands/commit/ASSET.md",
      `# Packaging Notes

## Strange Notes

- keep this prose visible
`,
      "asset",
    );

    expect(document.diagnostics).toEqual([
      {
        code: "unknown-section",
        message: "Unknown Markdown section 'Strange Notes'.",
        path: "packs/essentials/commands/commit/ASSET.md",
        severity: "warning",
      },
    ]);
    expect(document.sections).toEqual([
      { body: "- keep this prose visible", name: "Strange Notes" },
    ]);
  });

  test("accepts Experimental headings", () => {
    const document = parseMarkdownContract(
      "packs/essentials/commands/commit/ASSET.md",
      `# Packaging Notes

## Experimental:Planner

- try later
`,
      "asset",
    );

    expect(document.diagnostics).toEqual([]);
    expect(document.sections).toEqual([{ body: "- try later", name: "Experimental:Planner" }]);
  });
});
