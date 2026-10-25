import type { UserRole } from "../db/models.js";

/**
 * Explicit read-only allowlist for team members.
 *
 * Unknown tools default to denied for members. Admins retain access to
 * all valid tools exposed by the gateway.
 *
 * If a new upstream tool is introduced, review its behavior before adding
 * it to this list.
 */
const MEMBER_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  // WooCommerce: read-only operations
  "woo__list_products",
  "woo__list_orders",
  "woo__get_order",

  // Time MCP: these tools do not mutate application state
  "time__get_current_time",
  "time__convert_timezone",
  "time__echo",

  // Notes MCP: listing notes and echoing do not mutate state
  "notes__list_notes",
  "notes__echo",
]);

export function isToolAllowedForRole(
  role: UserRole,
  exposedToolName: string,
): boolean {
  if (role === "admin") {
    return true;
  }

  return MEMBER_READ_ONLY_TOOLS.has(exposedToolName);
}
