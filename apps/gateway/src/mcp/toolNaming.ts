/**
 * Tool names exposed by the gateway must identify their upstream server.
 *
 * Keeping the server slug in the name prevents identical upstream tool names,
 * such as time.echo and notes.echo, from colliding in one MCP tool list.
 */

export const MAX_EXPOSED_TOOL_NAME_LENGTH = 64;

const SERVER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,23}$/;

export type ToolNameBuildFailureReason =
  | "invalid_server_slug"
  | "invalid_upstream_tool_name"
  | "name_too_long";

export type ToolNameBuildResult =
  | { ok: true; name: string }
  | { ok: false; reason: ToolNameBuildFailureReason };

function characterLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Builds the public name defined in docs/03-contracts.md §5.
 * A caller can distinguish an overlong name so it can flag the server.
 */
export function buildExposedToolName(
  serverSlug: string,
  upstreamToolName: string,
): ToolNameBuildResult {
  if (!SERVER_SLUG_PATTERN.test(serverSlug)) {
    return { ok: false, reason: "invalid_server_slug" };
  }

  if (upstreamToolName.length === 0) {
    return { ok: false, reason: "invalid_upstream_tool_name" };
  }

  const name = `${serverSlug}__${upstreamToolName}`;

  if (characterLength(name) > MAX_EXPOSED_TOOL_NAME_LENGTH) {
    return { ok: false, reason: "name_too_long" };
  }

  return { ok: true, name };
}

export interface ParsedExposedToolName {
  serverSlug: string;
  upstreamToolName: string;
}

/**
 * Splits a public name at the first double underscore.
 * Any later underscores belong to the upstream tool's original name.
 */
export function parseExposedToolName(
  exposedName: string,
): ParsedExposedToolName | null {
  if (characterLength(exposedName) > MAX_EXPOSED_TOOL_NAME_LENGTH) {
    return null;
  }

  const separatorIndex = exposedName.indexOf("__");

  if (separatorIndex < 0) {
    return null;
  }

  const serverSlug = exposedName.slice(0, separatorIndex);
  const upstreamToolName = exposedName.slice(separatorIndex + 2);

  if (
    !SERVER_SLUG_PATTERN.test(serverSlug) ||
    upstreamToolName.length === 0
  ) {
    return null;
  }

  return { serverSlug, upstreamToolName };
}
