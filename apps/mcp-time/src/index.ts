import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export interface TimeServerConfig {
  upstreamToken?: string;
}

function tokenMatches(
  authorization: string | undefined,
  expectedToken: string | undefined,
): boolean {
  // Authentication is optional for this internal-only service.
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

function formatInTimeZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "long",
    hourCycle: "h23",
  }).format(instant);
}

function registerTools(server: McpServer): void {
  server.registerTool(
    "get_current_time",
    {
      description: "Get the current time as an ISO timestamp and formatted for an IANA time zone.",
      inputSchema: {
        timeZone: z.string().min(1).max(100).optional(),
      },
    },
    async ({ timeZone }) => {
      const zone = timeZone ?? "UTC";
      const now = new Date();

      try {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              instant: now.toISOString(),
              timeZone: zone,
              localTime: formatInTimeZone(now, zone),
            }),
          }],
        };
      } catch {
        return {
          isError: true,
          content: [{
            type: "text",
            text: "Invalid time zone. Use a valid IANA time-zone name.",
          }],
        };
      }
    },
  );

  server.registerTool(
    "convert_timezone",
    {
      description: "Format an ISO 8601 instant in a specified IANA time zone.",
      inputSchema: {
        instant: z.string().min(1).max(64).refine(
          (value) =>
            !Number.isNaN(Date.parse(value)) &&
            /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value),
          "instant must be an ISO 8601 timestamp with a time-zone offset",
        ),
        timeZone: z.string().min(1).max(100),
      },
    },
    async ({ instant, timeZone }) => {
      try {
        const date = new Date(instant);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              instant: date.toISOString(),
              timeZone,
              localTime: formatInTimeZone(date, timeZone),
            }),
          }],
        };
      } catch {
        return {
          isError: true,
          content: [{
            type: "text",
            text: "Invalid time zone. Use a valid IANA time-zone name.",
          }],
        };
      }
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
  const path = new URL(request.url ?? "/", "http://mcp-time.local").pathname;

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
    name: "urumi-mcp-time",
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

export function createTimeMcpHttpServer(
  config: TimeServerConfig = {},
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
  const port = validPort(process.env.PORT, 3002);
  createTimeMcpHttpServer().listen(port, "0.0.0.0", () => {
    console.log(`mcp-time listening on ${port}`);
  });
}
