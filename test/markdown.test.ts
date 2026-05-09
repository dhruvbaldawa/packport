// ABOUTME: Verifies packport's minimal Markdown control-plane parser.
// ABOUTME: Protects the PACK.md and ASSET.md grammar from accidental schema growth.

import { describe, expect, test } from "bun:test";
import { parseMarkdownContract } from "../src/core/markdown";

describe("parseMarkdownContract", () => {
  test("parses required PACK.md keys and named sections", () => {
    const document = parseMarkdownContract(
      "packs/essentials/PACK.md",
      `Name: Essentials
Version: 1.2.3
Description: Core agent workflows.

# Essentials

## Dependencies

- git
`,
      "pack",
    );

    expect(document.diagnostics).toEqual([]);
    expect(document.keys).toEqual({
      Description: "Core agent workflows.",
      Name: "Essentials",
      Version: "1.2.3",
    });
    expect(document.sections).toEqual([{ body: "- git", name: "Dependencies" }]);
  });

  test("reports missing required PACK.md keys", () => {
    const document = parseMarkdownContract("packs/essentials/PACK.md", "Name: Essentials", "pack");

    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "missing-pack-key",
      "missing-pack-key",
    ]);
  });

  test("rejects unknown structured keys before the first heading", () => {
    const document = parseMarkdownContract(
      "packs/essentials/PACK.md",
      `Name: Essentials
Version: 1.2.3
Description: Core agent workflows.
Owner: Dhruv
`,
      "pack",
    );

    expect(document.diagnostics).toContainEqual({
      code: "unknown-key",
      message: "Unknown pack key 'Owner'.",
      path: "packs/essentials/PACK.md",
      severity: "error",
    });
  });

  test("rejects duplicate structured keys", () => {
    const document = parseMarkdownContract(
      "packs/essentials/PACK.md",
      `Name: Essentials
Name: Duplicate
Version: 1.2.3
Description: Core agent workflows.
`,
      "pack",
    );

    expect(document.diagnostics).toContainEqual({
      code: "duplicate-key",
      message: "Duplicate pack key 'Name'.",
      path: "packs/essentials/PACK.md",
      severity: "error",
    });
  });

  test("validates Templated values", () => {
    const document = parseMarkdownContract(
      "packs/essentials/commands/commit/ASSET.md",
      "Templated: maybe\n",
      "asset",
    );

    expect(document.diagnostics).toEqual([
      {
        code: "invalid-templated-value",
        message: "Templated must be either 'true' or 'false'.",
        path: "packs/essentials/commands/commit/ASSET.md",
        severity: "error",
      },
    ]);
  });

  test("accepts boolean Templated values", () => {
    const trueDocument = parseMarkdownContract(
      "packs/essentials/commands/commit/ASSET.md",
      "Templated: true\n",
      "asset",
    );
    const falseDocument = parseMarkdownContract(
      "packs/essentials/commands/commit/ASSET.md",
      "Templated: false\n",
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
