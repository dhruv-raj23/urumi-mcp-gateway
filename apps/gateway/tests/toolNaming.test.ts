import { describe, expect, it } from "vitest";

import {
  buildExposedToolName,
  MAX_EXPOSED_TOOL_NAME_LENGTH,
  parseExposedToolName,
} from "../src/mcp/toolNaming.js";

describe("buildExposedToolName", () => {
  it("prefixes the upstream tool with its server slug", () => {
    expect(buildExposedToolName("woo", "list_orders")).toEqual({
      ok: true,
      name: "woo__list_orders",
    });
  });

  it("keeps identical tool names from different servers distinct", () => {
    const time = buildExposedToolName("time", "echo");
    const notes = buildExposedToolName("notes", "echo");

    expect(time).toEqual({ ok: true, name: "time__echo" });
    expect(notes).toEqual({ ok: true, name: "notes__echo" });

    if (time.ok && notes.ok) {
      expect(time.name).not.toBe(notes.name);
    }
  });

  it("accepts names at the 64-character limit", () => {
    const result = buildExposedToolName("woo", "x".repeat(59));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toHaveLength(MAX_EXPOSED_TOOL_NAME_LENGTH);
    }
  });

  it("rejects names longer than the contract limit", () => {
    expect(buildExposedToolName("woo", "x".repeat(60))).toEqual({
      ok: false,
      reason: "name_too_long",
    });
  });

  it.each(["", "a", "Woo", "bad slug", "a".repeat(25)])(
    "rejects invalid server slug %j",
    (slug) => {
      expect(buildExposedToolName(slug, "echo")).toEqual({
        ok: false,
        reason: "invalid_server_slug",
      });
    },
  );

  it("rejects an empty upstream tool name", () => {
    expect(buildExposedToolName("woo", "")).toEqual({
      ok: false,
      reason: "invalid_upstream_tool_name",
    });
  });
});

describe("parseExposedToolName", () => {
  it("extracts the server slug and upstream tool name", () => {
    expect(parseExposedToolName("woo__list_orders")).toEqual({
      serverSlug: "woo",
      upstreamToolName: "list_orders",
    });
  });

  it("preserves double underscores inside the upstream tool name", () => {
    expect(parseExposedToolName("notes__tool__with__underscores")).toEqual({
      serverSlug: "notes",
      upstreamToolName: "tool__with__underscores",
    });
  });

  it.each(["echo", "woo__", "Woo__echo", "a__echo", "bad slug__echo"])(
    "rejects malformed exposed name %j",
    (name) => {
      expect(parseExposedToolName(name)).toBeNull();
    },
  );

  it("rejects exposed names longer than 64 characters", () => {
    expect(parseExposedToolName(`woo__${"x".repeat(60)}`)).toBeNull();
  });
});
