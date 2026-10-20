import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "node:http";

import { createTimeMcpHttpServer } from "../src/index.js";

const TOKEN = "test-time-upstream-token";
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createTimeMcpHttpServer({ upstreamToken: TOKEN });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Time test server did not bind a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

async function withClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });

  const client = new Client(
    { name: "mcp-time-test", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport, { timeout: 5_000 });
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (text === undefined) throw new Error("Expected text tool content");
  return text;
}

describe("mcp-time", () => {
  it("serves health checks", async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("requires the configured upstream bearer token", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "bad-token-test", version: "1.0.0" },
        },
      }),
    });

    expect(response.status).toBe(401);
  });

  it("exposes get_current_time, convert_timezone, and echo", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools({}, { timeout: 5_000 });
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "convert_timezone",
        "echo",
        "get_current_time",
      ]);
    });
  });

  it("returns the current instant formatted in a requested time zone", async () => {
    await withClient(async (client) => {
      const result = await client.callTool(
        {
          name: "get_current_time",
          arguments: { timeZone: "Asia/Kolkata" },
        },
        CallToolResultSchema,
        { timeout: 5_000 },
      );

      expect(result.isError).not.toBe(true);
      const data = JSON.parse(textOf(result));
      expect(data.timeZone).toBe("Asia/Kolkata");
      expect(Number.isNaN(Date.parse(data.instant))).toBe(false);
      expect(data.localTime).toEqual(expect.any(String));
    });
  });

  it("converts an ISO instant to a target time zone", async () => {
    await withClient(async (client) => {
      const result = await client.callTool(
        {
          name: "convert_timezone",
          arguments: {
            instant: "2026-10-20T10:00:00Z",
            timeZone: "Asia/Kolkata",
          },
        },
        CallToolResultSchema,
        { timeout: 5_000 },
      );

      expect(result.isError).not.toBe(true);
      const data = JSON.parse(textOf(result));
      expect(data.instant).toBe("2026-10-20T10:00:00.000Z");
      expect(data.timeZone).toBe("Asia/Kolkata");
      expect(data.localTime).toContain("15:30");
    });
  });

  it("echoes messages and returns a tool error for invalid time zones", async () => {
    await withClient(async (client) => {
      const echo = await client.callTool(
        { name: "echo", arguments: { message: "time echo works" } },
        CallToolResultSchema,
        { timeout: 5_000 },
      );
      expect(textOf(echo)).toBe("time echo works");

      const invalidZone = await client.callTool(
        {
          name: "get_current_time",
          arguments: { timeZone: "Not/A_Real_Zone" },
        },
        CallToolResultSchema,
        { timeout: 5_000 },
      );
      expect(invalidZone.isError).toBe(true);
      expect(textOf(invalidZone)).toContain("Invalid time zone");
    });
  });
});
