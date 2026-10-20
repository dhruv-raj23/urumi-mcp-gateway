import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "node:http";

import { createNotesMcpHttpServer } from "../src/index.js";

const TOKEN = "test-notes-upstream-token";
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createNotesMcpHttpServer({ upstreamToken: TOKEN });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Notes test server did not bind a TCP port");
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
    { name: "mcp-notes-test", version: "1.0.0" },
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

describe("mcp-notes", () => {
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

  it("exposes add_note, list_notes, and echo", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools({}, { timeout: 5_000 });
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "add_note",
        "echo",
        "list_notes",
      ]);
    });
  });

  it("adds a note and lists it across stateless HTTP requests", async () => {
    const noteText = `T05 acceptance ${Date.now()}`;

    await withClient(async (client) => {
      const added = await client.callTool(
        { name: "add_note", arguments: { text: noteText } },
        CallToolResultSchema,
        { timeout: 5_000 },
      );

      expect(added.isError).not.toBe(true);
      const addResult = JSON.parse(textOf(added));
      expect(addResult.added).toBe(true);
      expect(addResult.id).toEqual(expect.any(String));

      const listed = await client.callTool(
        { name: "list_notes", arguments: { limit: 20 } },
        CallToolResultSchema,
        { timeout: 5_000 },
      );

      expect(listed.isError).not.toBe(true);
      const listResult = JSON.parse(textOf(listed));
      expect(listResult.notes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: addResult.id,
            text: noteText,
          }),
        ]),
      );
    });
  });

  it("echoes the supplied message", async () => {
    await withClient(async (client) => {
      const result = await client.callTool(
        { name: "echo", arguments: { message: "notes echo works" } },
        CallToolResultSchema,
        { timeout: 5_000 },
      );

      expect(textOf(result)).toBe("notes echo works");
    });
  });
});
