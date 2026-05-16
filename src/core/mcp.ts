// ABOUTME: Converts Claude-style .mcp.json support files into target-native MCP config.
// ABOUTME: Keeps pack-level MCP declarations portable while emitters own target syntax.

import { readFile } from "node:fs/promises";
import type { Diagnostic } from "./types";

export type PortableMcpServers = Readonly<Record<string, PortableMcpServer>>;

export type PortableMcpServer = {
  readonly args?: readonly string[];
  readonly command?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly type?: string;
  readonly url?: string;
};

/** Reads Claude-style .mcp.json and returns a normalized server map. */
export async function readPortableMcpServers(
  path: string,
  diagnostics: Diagnostic[],
): Promise<PortableMcpServers> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    diagnostics.push({
      code: "invalid-mcp-config",
      message: error instanceof Error ? error.message : "MCP config must contain valid JSON.",
      path,
      severity: "error",
    });
    return {};
  }

  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    diagnostics.push({
      code: "invalid-mcp-config",
      message: "MCP config must contain an mcpServers object.",
      path,
      severity: "error",
    });
    return {};
  }

  const servers: Record<string, PortableMcpServer> = {};

  for (const [name, server] of Object.entries(parsed.mcpServers).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!isSafeMcpName(name)) {
      diagnostics.push({
        code: "invalid-mcp-server-name",
        message: `MCP server name must be a safe config key: ${name}.`,
        path,
        severity: "error",
      });
      continue;
    }

    if (!isRecord(server)) {
      diagnostics.push({
        code: "invalid-mcp-server",
        message: `MCP server entry must be an object: ${name}.`,
        path,
        severity: "error",
      });
      continue;
    }

    const normalized = normalizeMcpServer(name, server, path, diagnostics);

    if (normalized) {
      servers[name] = normalized;
    }
  }

  return servers;
}

/** Converts portable MCP servers to OpenCode opencode.json mcp entries. */
export function renderOpenCodeMcpServers(
  servers: PortableMcpServers,
  path: string,
  diagnostics: Diagnostic[],
): Readonly<Record<string, unknown>> {
  const rendered: Record<string, unknown> = {};

  for (const [name, server] of Object.entries(servers)) {
    if (server.command) {
      rendered[name] = {
        type: "local",
        command: [server.command, ...(server.args ?? [])].map(convertOpenCodeEnvPlaceholders),
        ...(server.env && Object.keys(server.env).length > 0
          ? { environment: convertOpenCodeEnvPlaceholdersInRecord(server.env) }
          : {}),
      };
      continue;
    }

    if (server.url) {
      rendered[name] = {
        type: "remote",
        url: convertOpenCodeEnvPlaceholders(server.url),
        ...(server.headers && Object.keys(server.headers).length > 0
          ? { headers: convertOpenCodeEnvPlaceholdersInRecord(server.headers) }
          : {}),
      };
      continue;
    }

    diagnostics.push({
      code: "unsupported-mcp-server",
      message: `MCP server must declare command or url: ${name}.`,
      path,
      severity: "warning",
    });
  }

  return rendered;
}

/** Converts portable MCP servers to a managed Codex config.toml block. */
export function renderCodexMcpConfig(
  servers: PortableMcpServers,
  path: string,
  diagnostics: Diagnostic[],
): string {
  const chunks: string[] = [];

  for (const [name, server] of Object.entries(servers)) {
    const lines = [`[mcp_servers.${tomlKey(name)}]`];

    if (server.command) {
      warnUnsupportedCodexPlaceholders(name, "command", server.command, path, diagnostics);
      lines.push(`command = ${tomlString(server.command)}`);

      if (server.args && server.args.length > 0) {
        for (const arg of server.args) {
          warnUnsupportedCodexPlaceholders(name, "args", arg, path, diagnostics);
        }

        lines.push(`args = ${tomlStringArray(server.args)}`);
      }

      const envVars = Object.entries(server.env ?? {})
        .filter(([, value]) => envPlaceholderName(value) !== undefined)
        .map(([, value]) => envPlaceholderName(value) as string);
      const env = Object.fromEntries(
        Object.entries(server.env ?? {}).filter(
          ([, value]) => envPlaceholderName(value) === undefined,
        ),
      );

      if (envVars.length > 0) {
        lines.push(`env_vars = ${tomlStringArray(envVars)}`);
      }

      if (Object.keys(env).length > 0) {
        for (const [key, value] of Object.entries(env)) {
          warnUnsupportedCodexPlaceholders(name, `env.${key}`, value, path, diagnostics);
        }

        lines.push(`env = ${tomlInlineTable(env)}`);
      }
    } else if (server.url) {
      warnUnsupportedCodexPlaceholders(name, "url", server.url, path, diagnostics);
      lines.push(`url = ${tomlString(server.url)}`);
      const bearerTokenEnvVar = codexBearerTokenEnvVar(server.headers);

      const envHeaders = Object.fromEntries(
        Object.entries(server.headers ?? {}).flatMap(([key, value]) => {
          if (key === "Authorization" && bearerTokenEnvVar !== undefined) {
            return [];
          }

          const envName = envPlaceholderName(value);
          return envName === undefined ? [] : [[key, envName]];
        }),
      );
      const staticHeaders = Object.fromEntries(
        Object.entries(server.headers ?? {}).filter(
          ([key, value]) =>
            !(key === "Authorization" && bearerTokenEnvVar !== undefined) &&
            envPlaceholderName(value) === undefined,
        ),
      );

      for (const [key, value] of Object.entries(staticHeaders)) {
        warnUnsupportedCodexPlaceholders(name, `headers.${key}`, value, path, diagnostics);
      }

      if (bearerTokenEnvVar !== undefined) {
        lines.push(`bearer_token_env_var = ${tomlString(bearerTokenEnvVar)}`);
      }

      if (Object.keys(staticHeaders).length > 0) {
        lines.push(`http_headers = ${tomlInlineTable(staticHeaders)}`);
      }

      if (Object.keys(envHeaders).length > 0) {
        lines.push(`env_http_headers = ${tomlInlineTable(envHeaders)}`);
      }
    } else {
      diagnostics.push({
        code: "unsupported-mcp-server",
        message: `MCP server must declare command or url: ${name}.`,
        path,
        severity: "warning",
      });
      continue;
    }

    lines.push("enabled = true");
    chunks.push(lines.join("\n"));
  }

  return chunks.join("\n\n");
}

/** Replaces or appends a managed block in a preserved text file. */
export function mergeManagedBlock(
  existing: string,
  startMarker: string,
  endMarker: string,
  block: string,
): string {
  const managed = `${startMarker}\n${block.trimEnd()}\n${endMarker}`;
  const start = existing.indexOf(startMarker);
  const end = existing.indexOf(endMarker);

  if (start !== -1 && end !== -1 && end >= start) {
    return `${existing.slice(0, start)}${managed}${existing.slice(end + endMarker.length)}`;
  }

  return `${existing.trimEnd()}${existing.trimEnd() ? "\n\n" : ""}${managed}\n`;
}

/** Removes a complete managed block while preserving surrounding unmanaged text. */
export function removeManagedBlock(
  existing: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = existing.indexOf(startMarker);
  const end = existing.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    return existing;
  }

  const next = `${existing.slice(0, start)}${existing.slice(end + endMarker.length)}`;
  const trimmed = next.replace(/\n{3,}/g, "\n\n").trimEnd();
  return trimmed === "" ? "" : `${trimmed}\n`;
}

function normalizeMcpServer(
  name: string,
  server: Record<string, unknown>,
  path: string,
  diagnostics: Diagnostic[],
): PortableMcpServer | undefined {
  const command = server.command;
  const args = server.args;
  const env = server.env;
  const headers = server.headers;
  const type = server.type;
  const url = server.url;

  if (command !== undefined && typeof command !== "string") {
    diagnostics.push(invalidMcpServerField(name, "command", path));
    return undefined;
  }

  if (
    args !== undefined &&
    (!Array.isArray(args) || !args.every((arg) => typeof arg === "string"))
  ) {
    diagnostics.push(invalidMcpServerField(name, "args", path));
    return undefined;
  }

  if (env !== undefined && !isStringRecord(env)) {
    diagnostics.push(invalidMcpServerField(name, "env", path));
    return undefined;
  }

  if (headers !== undefined && !isStringRecord(headers)) {
    diagnostics.push(invalidMcpServerField(name, "headers", path));
    return undefined;
  }

  if (type !== undefined && typeof type !== "string") {
    diagnostics.push(invalidMcpServerField(name, "type", path));
    return undefined;
  }

  if (url !== undefined && typeof url !== "string") {
    diagnostics.push(invalidMcpServerField(name, "url", path));
    return undefined;
  }

  return {
    ...(command ? { command } : {}),
    ...(Array.isArray(args) ? { args } : {}),
    ...(isStringRecord(env) ? { env } : {}),
    ...(isStringRecord(headers) ? { headers } : {}),
    ...(typeof type === "string" ? { type } : {}),
    ...(url ? { url } : {}),
  };
}

function invalidMcpServerField(name: string, field: string, path: string): Diagnostic {
  return {
    code: "invalid-mcp-server",
    message: `MCP server ${name} has an invalid ${field} field.`,
    path,
    severity: "error",
  };
}

function convertOpenCodeEnvPlaceholdersInRecord(
  record: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, convertOpenCodeEnvPlaceholders(value)]),
  );
}

function convertOpenCodeEnvPlaceholders(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "{env:$1}");
}

function warnUnsupportedCodexPlaceholders(
  serverName: string,
  fieldName: string,
  value: string,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value)) {
    return;
  }

  diagnostics.push({
    code: "unsupported-codex-mcp-placeholder",
    message: `Codex MCP server ${serverName} ${fieldName} contains an environment placeholder that Codex may treat literally.`,
    path,
    severity: "warning",
  });
}

function envPlaceholderName(value: string): string | undefined {
  return /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value)?.[1];
}

function codexBearerTokenEnvVar(
  headers: Readonly<Record<string, string>> | undefined,
): string | undefined {
  const authorization = headers?.Authorization;

  if (authorization === undefined) {
    return undefined;
  }

  return /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(authorization)?.[1];
}

function tomlKey(value: string): string {
  return tomlString(value);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

function tomlInlineTable(record: Readonly<Record<string, string>>): string {
  return `{ ${Object.entries(record)
    .map(([key, value]) => `${tomlKey(key)} = ${tomlString(value)}`)
    .join(", ")} }`;
}

function isSafeMcpName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
