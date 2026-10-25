import { describe, expect, it } from "vitest";

import { isToolAllowedForRole } from "../src/mcp/toolPermissions.js";

describe("isToolAllowedForRole", () => {
  it("allows members to use approved read-only tools", () => {
    const allowedTools = [
      "woo__list_products",
      "woo__list_orders",
      "woo__get_order",
      "time__get_current_time",
      "time__convert_timezone",
      "time__echo",
      "notes__list_notes",
      "notes__echo",
    ];

    for (const tool of allowedTools) {
      expect(isToolAllowedForRole("member", tool), tool).toBe(true);
    }
  });

  it("denies member access to known write tools", () => {
    const deniedTools = [
      "woo__create_product",
      "woo__update_order_status",
      "notes__add_note",
    ];

    for (const tool of deniedTools) {
      expect(isToolAllowedForRole("member", tool), tool).toBe(false);
    }
  });

  it("denies unknown tools to members by default", () => {
    expect(
      isToolAllowedForRole("member", "custom__unknown_operation"),
    ).toBe(false);
  });

  it("preserves admin access to write and newly registered tools", () => {
    expect(
      isToolAllowedForRole("admin", "woo__create_product"),
    ).toBe(true);

    expect(
      isToolAllowedForRole("admin", "woo__update_order_status"),
    ).toBe(true);

    expect(
      isToolAllowedForRole("admin", "notes__add_note"),
    ).toBe(true);

    expect(
      isToolAllowedForRole("admin", "custom__unknown_operation"),
    ).toBe(true);
  });
});
