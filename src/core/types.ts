// ABOUTME: Defines packport's core index, contract, and diagnostic types.
// ABOUTME: Keeps discovery and parser modules aligned on one small data shape.

export type AssetKind = "agent" | "command" | "hook" | "instruction" | "skill";

export type DiagnosticSeverity = "error" | "warning";

export type ContractKind = "asset" | "pack";

export type MarkdownFieldValue = string | readonly string[];

export type MarkdownKeyValues = Record<string, MarkdownFieldValue>;

export type PortableRefNamespace = "config" | "mcp" | "tool";

export type PortableRef = {
  readonly end: number;
  readonly name: string;
  readonly namespace: PortableRefNamespace;
  readonly path: string;
  readonly raw: string;
  readonly start: number;
};

export type SectionName =
  | "Configuration"
  | "Dependencies"
  | "Needs"
  | "Notes"
  | "Source Constraints"
  | `Experimental:${string}`;

export type AssetContract = {
  readonly path: string;
  readonly keys: MarkdownKeyValues;
  readonly sections: readonly MarkdownSection[];
};

export type AssetIndex = {
  readonly declaredRefs: readonly PortableRef[];
  readonly id: string;
  readonly name: string;
  readonly kind: AssetKind;
  readonly directoryPath: string;
  readonly payloadPaths: readonly string[];
  readonly payloadRefs: readonly PortableRef[];
  readonly supportPaths: readonly string[];
  readonly contract?: AssetContract;
};

export type Diagnostic = {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly path: string;
};

export type DiscoveryResult = {
  readonly index: PackRepositoryIndex;
  readonly diagnostics: readonly Diagnostic[];
};

export type MarkdownDocument = {
  readonly path: string;
  readonly keys: MarkdownKeyValues;
  readonly sections: readonly MarkdownSection[];
  readonly diagnostics: readonly Diagnostic[];
};

export type MarkdownSection = {
  readonly name: string;
  readonly body: string;
};

export type PackIndex = {
  readonly declaredRefs: readonly PortableRef[];
  readonly id: string;
  readonly directoryPath: string;
  readonly packFilePath: string;
  readonly supportPaths: readonly string[];
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly sections: readonly MarkdownSection[];
  readonly assets: readonly AssetIndex[];
};

export type PackRepositoryIndex = {
  readonly rootPath: string;
  readonly packs: readonly PackIndex[];
};
