import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import type {
  CallToolResult,
  ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

import type {
  AuditLogDocument,
  ServerDocument,
} from "../src/db/models.js";
import type { GatewayCollections } from "../src/db/mongo.js";
import {
  GatewayAggregator,
  type GatewayMcpUser,
  type UpstreamMcpClientFactory,
} from "../src/mcp/aggregator.js";

function makeServer(
  slug: string,
  overrides: Partial<ServerDocument> = {},
): ServerDocument {
  return {
    _id: new ObjectId(),
    slug,
    name: slug,
    url: "http://127.0.0.1:3001/mcp",
    authType: "none",
    enabled: true,
    status: "connected",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeTool(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  };
}

function makeCollections(servers: ServerDocument[]) {
  const audits: AuditLogDocument[] = [];

  const serverCollection = {
    find(filter: Partial<ServerDocument>) {
      const selected = servers.filter((server) =>
        Object.entries(filter).every(
          ([key, value]) =>
            server[key as keyof ServerDocument] === value,
        ),
      );

      const cursor = {
        sort: (order?: Record<string, 1 | -1>) => {
          const [field, direction] = Object.entries(order ?? {})[0] ?? [];
          if (field) {
            selected.sort((a, b) => {
              const left = String(a[field as keyof ServerDocument] ?? "");
              const right = String(b[field as keyof ServerDocument] ?? "");
              return left.localeCompare(right) * (direction ?? 1);
            });
          }
          return cursor;
        },
        toArray: async () => selected,
      };

      return cursor;
    },

    findOne: async (filter: Partial<ServerDocument>) =>
      servers.find((server) =>
        Object.entries(filter).every(
          ([key, value]) =>
            server[key as keyof ServerDocument] === value,
        ),
      ) ?? null,

    updateOne: async (
      filter: { _id: ObjectId },
      update: {
        $set?: Partial<ServerDocument>;
        $unset?: Record<string, unknown>;
      },
    ) => {
      const server = servers.find((item) => item._id.equals(filter._id));
      if (!server) {
        return { matchedCount: 0 };
      }

      Object.assign(server, update.$set ?? {});

      for (const key of Object.keys(update.$unset ?? {})) {
        delete (server as unknown as Record<string, unknown>)[key];
      }

      return { matchedCount: 1 };
    },
  };

  const auditCollection = {
    insertOne: async (entry: AuditLogDocument) => {
      audits.push(entry);
      return { acknowledged: true, insertedId: entry._id };
    },
  };

  const collections = {
    servers: serverCollection,
    auditlogs: auditCollection,
  } as unknown as GatewayCollections;

  return { collections, servers, audits };
}

function makeUser(): GatewayMcpUser {
  return {
    userId: new ObjectId(),
    email: "member@example.com",
    role: "member",
  };
}

function makeFactory(
  hooks: {
    listTools?: (server: ServerDocument) => Promise<ListToolsResult>;
    callTool?: (
      server: ServerDocument,
      name: string,
      args: Record<string, unknown>,
    ) => Promise<CallToolResult>;
  } = {},
): UpstreamMcpClientFactory {
  return async (server) => ({
    listTools: async () =>
      hooks.listTools
        ? hooks.listTools(server)
        : { tools: [makeTool("echo")] },

    callTool: async (name, args) =>
      hooks.callTool
        ? hooks.callTool(server, name, args)
        : { content: [{ type: "text", text: `${server.slug}:${name}` }] },

    close: async () => undefined,
  });
}

describe("GatewayAggregator.listTools", () => {
  it("prefixes the upstream tool name and description", async () => {
    const fixture = makeCollections([makeServer("woo")]);
    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory(),
    });

    const result = await aggregator.listTools(makeUser());

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.name).toBe("woo__echo");
    expect(result.tools[0]?.description).toBe("[woo] Tool echo");
  });

  it("keeps duplicate tool names distinct across servers", async () => {
    const fixture = makeCollections([
      makeServer("time"),
      makeServer("notes"),
    ]);
    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory(),
    });

    const result = await aggregator.listTools(makeUser());

    expect(result.tools.map((tool) => tool.name)).toEqual([
      "notes__echo",
      "time__echo",
    ]);
  });

  it("omits a failed server and marks it unreachable while keeping healthy tools", async () => {
    const dead = makeServer("dead");
    const woo = makeServer("woo");
    const fixture = makeCollections([dead, woo]);

    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory({
        listTools: async (server) => {
          if (server.slug === "dead") {
            throw new Error("internal URL or secret must not leak");
          }
          return { tools: [makeTool("list_orders")] };
        },
      }),
    });

    const result = await aggregator.listTools(makeUser());

    expect(result.tools.map((tool) => tool.name)).toEqual(["woo__list_orders"]);
    expect(dead.status).toBe("unreachable");
    expect(dead.statusReason).toBe("Upstream tool discovery failed");
    expect(woo.status).toBe("connected");
  });

  it("omits disabled servers", async () => {
    const fixture = makeCollections([
      makeServer("woo"),
      makeServer("notes", { enabled: false, status: "disabled" }),
    ]);
    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory(),
    });

    const result = await aggregator.listTools(makeUser());

    expect(result.tools.map((tool) => tool.name)).toEqual(["woo__echo"]);
  });

  it("skips overlong exposed names and flags the server with a warning", async () => {
    const server = makeServer("woo");
    const fixture = makeCollections([server]);

    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory({
        listTools: async () => ({
          tools: [makeTool("x".repeat(60)), makeTool("echo")],
        }),
      }),
    });

    const result = await aggregator.listTools(makeUser());

    expect(result.tools.map((tool) => tool.name)).toEqual(["woo__echo"]);
    expect(server.status).toBe("connected");
    expect(server.statusReason).toContain("warning:");
  });

  it("bounds the combined tool list and flags servers whose tools are omitted", async () => {
    const server = makeServer("woo");
    const fixture = makeCollections([server]);
    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory({
        listTools: async () => ({
          tools: [
            { ...makeTool("oversized"), description: "x".repeat(100_000) },
            makeTool("echo"),
          ],
        }),
      }),
    });

    const result = await aggregator.listTools(makeUser());

    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(100_000);
    expect(result.tools.map((tool) => tool.name)).toEqual(["woo__echo"]);
    expect(server.status).toBe("connected");
    expect(server.statusReason).toContain("truncated at the 100 KB response limit");
  });

  it("refreshes status for an unreachable server when health is checked", async () => {
    const server = makeServer("woo", { status: "unreachable" });
    const fixture = makeCollections([server]);
    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory(),
    });

    await aggregator.refreshAllServerHealth();

    expect(server.status).toBe("connected");
    expect(server.statusReason).toBeUndefined();
    expect(server.lastCheckedAt).toBeInstanceOf(Date);
  });
});

describe("GatewayAggregator.callTool", () => {
  it("routes to the correct upstream tool with unchanged arguments", async () => {
    const server = makeServer("woo");
    const fixture = makeCollections([server]);
    const args = { id: 17 };
    let called: { server: string; name: string; args: Record<string, unknown> } | undefined;

    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory({
        callTool: async (target, name, toolArgs) => {
          called = { server: target.slug, name, args: toolArgs };
          return { content: [{ type: "text", text: "order result" }] };
        },
      }),
    });

    const result = await aggregator.callTool(makeUser(), "mcp", "woo__get_order", args);

    expect(called).toEqual({
      server: "woo",
      name: "get_order",
      args,
    });
    expect(result.content).toEqual([
      { type: "text", text: "[woo] order result" },
    ]);
    expect(result.isError).toBeUndefined();
    expect(fixture.audits).toHaveLength(1);
    expect(fixture.audits[0]?.outcome).toBe("success");
    expect(fixture.audits[0]?.toolName).toBe("get_order");
  });

  it("returns an isError result and audits denied calls to unavailable servers", async () => {
    const server = makeServer("woo", { status: "unreachable" });
    const fixture = makeCollections([server]);
    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory(),
    });

    const result = await aggregator.callTool(
      makeUser(),
      "mcp",
      "woo__list_orders",
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "server 'woo' is unavailable" },
    ]);
    expect(fixture.audits).toHaveLength(1);
    expect(fixture.audits[0]?.outcome).toBe("denied");
  });

  it("returns an isError result and audits timed-out calls", async () => {
    const server = makeServer("woo");
    const fixture = makeCollections([server]);

    const aggregator = new GatewayAggregator(fixture.collections, {
      callTimeoutMs: 15,
      clientFactory: async () => ({
        listTools: async () => ({ tools: [] }),
        callTool: async () => new Promise<CallToolResult>(() => undefined),
        close: async () => undefined,
      }),
    });

    const result = await aggregator.callTool(
      makeUser(),
      "mcp",
      "woo__list_orders",
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "Upstream tool call timed out" },
    ]);
    expect(server.status).toBe("unreachable");
    expect(fixture.audits[0]?.outcome).toBe("timeout");
  });

  it("rejects malformed public tool names and records denial", async () => {
    const fixture = makeCollections([]);
    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory(),
    });

    const result = await aggregator.callTool(makeUser(), "mcp", "no_prefix", {});

    expect(result.isError).toBe(true);
    expect(fixture.audits).toHaveLength(1);
    expect(fixture.audits[0]?.outcome).toBe("denied");
  });

  it("returns an error when an upstream result exceeds 100 KB", async () => {
    const fixture = makeCollections([makeServer("woo")]);
    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory({
        callTool: async () => ({
          content: [{ type: "text", text: "x".repeat(101_000) }],
        }),
      }),
    });

    const result = await aggregator.callTool(makeUser(), "mcp", "woo__echo", {});

    expect(result.isError).toBe(true);
    expect(fixture.audits[0]?.outcome).toBe("error");
  });
});

describe("GatewayAggregator cached tool metadata", () => {
  it("exposes discovered tool names and descriptions for the server API", async () => {
    const server = makeServer("time");
    const fixture = makeCollections([server]);
    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory(),
    });

    expect(aggregator.getCachedTools(server)).toEqual([]);

    await aggregator.listTools(makeUser());

    expect(aggregator.getCachedTools(server)).toEqual([
      {
        name: "time__echo",
        description: "[time] Tool echo",
      },
    ]);
  });

  it("expires cached metadata after 60 seconds", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));

      const server = makeServer("time");
      const fixture = makeCollections([server]);
      const aggregator = new GatewayAggregator(fixture.collections, {
        clientFactory: makeFactory(),
      });

      await aggregator.listTools(makeUser());
      expect(aggregator.getCachedTools(server)).toHaveLength(1);

      vi.setSystemTime(new Date("2026-10-20T12:01:00.001Z"));

      expect(aggregator.getCachedTools(server)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears cached metadata when discovery fails", async () => {
    let shouldFail = false;
    const server = makeServer("woo");
    const fixture = makeCollections([server]);

    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory({
        listTools: async () => {
          if (shouldFail) throw new Error("upstream unavailable");
          return { tools: [makeTool("list_orders")] };
        },
      }),
    });

    await aggregator.listTools(makeUser());

    expect(aggregator.getCachedTools(server)).toEqual([
      {
        name: "woo__list_orders",
        description: "[woo] Tool list_orders",
      },
    ]);

    shouldFail = true;
    await aggregator.listTools(makeUser());

    expect(server.status).toBe("unreachable");
    expect(aggregator.getCachedTools(server)).toEqual([]);
  });

  it("clears cached metadata when a server becomes disabled", async () => {
    const server = makeServer("notes");
    const fixture = makeCollections([server]);
    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory(),
    });

    await aggregator.listTools(makeUser());
    expect(aggregator.getCachedTools(server)).toHaveLength(1);

    server.enabled = false;
    await aggregator.refreshAllServerHealth();

    expect(server.status).toBe("disabled");
    expect(aggregator.getCachedTools(server)).toEqual([]);
  });

  it("does not expose cached metadata while a server is unreachable", async () => {
    const server = makeServer("woo");
    const fixture = makeCollections([server]);
    const aggregator = new GatewayAggregator(fixture.collections, {
      clientFactory: makeFactory(),
    });

    await aggregator.listTools(makeUser());
    expect(aggregator.getCachedTools(server)).toHaveLength(1);

    server.status = "unreachable";
    expect(aggregator.getCachedTools(server)).toEqual([]);
  });
});
