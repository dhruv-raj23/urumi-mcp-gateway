import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export interface NotesServerConfig {
  upstreamToken?: string;
}

export interface Note {
  id: string;
  text: string;
  createdAt: string;
}

// Deliberate T05 choice: memory-backed notes, shared by requests in this process.
// Notes are lost when this process/container restarts.
const notes: Note[] = [];
const MAX_NOTES = 1_000;

function tokenMatches(
  authorization: string | undefined,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken) return true;
  if (!authorization) return false;

  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match?.[1]) return false;

  const actual = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(expectedToken, "utf8");

  return actual.length === expected.length &&
    timingSafeEqual(actual, expected);
}

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function registerTools(server: McpServer): void {
  server.registerTool(
    "add_note",
    {
      description: "Store a short note in this mcp-notes process's in-memory note list.",
      inputSchema: {
        text: z.string().trim().min(1).max(5_000),
      },
    },
    async ({ text }) => {
      if (notes.length >= MAX_NOTES) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: "Note capacity reached; no note was added.",
          }],
        };
      }

      const note: Note = {
        id: randomUUID(),
        text,
        createdAt: new Date().toISOString(),
      };
      notes.push(note);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            added: true,
            id: note.id,
            createdAt: note.createdAt,
          }),
        }],
      };
    },
  );

  server.registerTool(
    "list_notes",
    {
      description: "List recent notes held in this process's in-memory note list.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ limit }) => {
      const count = limit ?? 20;
      const recent = notes.slice(-count).reverse();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ count: recent.length, notes: recent }),
        }],
      };
    },
  );

  server.registerTool(
    "echo",
    {
      description: "Return the supplied message unchanged.",
      inputSchema: {
        message: z.string().max(5_000),
      },
    },
    async ({ message }) => ({
      content: [{ type: "text", text: message }],
    }),
  );
}

async function handleRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  upstreamToken: string | undefined,
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://mcp-notes.local").pathname;

  if (request.method === "GET" && path === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (path !== "/mcp") {
    request.resume();
    sendJson(response, 404, {
      error: { code: "not_found", message: "Not found" },
    });
    return;
  }

  if (request.method !== "POST") {
    request.resume();
    response.writeHead(405, { Allow: "POST", "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (!tokenMatches(request.headers.authorization, upstreamToken)) {
    request.resume();
    response.setHeader("WWW-Authenticate", "Bearer");
    sendJson(response, 401, {
      error: { code: "unauthorized", message: "Invalid or missing bearer token" },
    });
    return;
  }

  const mcpServer = new McpServer({
    name: "urumi-mcp-notes",
    version: "0.0.0",
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    registerTools(mcpServer);
    await mcpServer.connect(transport);
    await transport.handleRequest(request, response);
  } catch {
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: { code: "internal_error", message: "MCP request could not be processed" },
      });
    } else if (!response.writableEnded) {
      response.destroy();
    }
  } finally {
    await mcpServer.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

export function createNotesMcpHttpServer(
  config: NotesServerConfig = {},
): Server {
  const upstreamToken = config.upstreamToken ?? process.env.UPSTREAM_AUTH_TOKEN;

  return createServer((request, response) => {
    void handleRequest(request, response, upstreamToken).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: { code: "internal_error", message: "Request could not be processed" },
        });
      } else if (!response.writableEnded) {
        response.destroy();
      }
    });
  });
}

function validPort(raw: string | undefined, fallback: number): number {
  const port = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const port = validPort(process.env.PORT, 3003);
  createNotesMcpHttpServer().listen(port, "0.0.0.0", () => {
    console.log(`mcp-notes listening on ${port}`);
  });
}
