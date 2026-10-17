import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { registerWooCommerceTools } from "./tools.js";
import { WooCommerceClient } from "./woocommerce.js";

const REQUIRED_ENV = [
  "WC_BASE_URL",
  "WC_CONSUMER_KEY",
  "WC_CONSUMER_SECRET",
  "UPSTREAM_AUTH_TOKEN",
] as const;

export interface WooMcpConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  upstreamToken: string;
  fetchImpl?: typeof fetch;
}

function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}

function tokenMatches(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorizationHeader) {
    return false;
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorizationHeader);
  const suppliedToken = match?.[1];

  if (!suppliedToken) {
    return false;
  }

  const supplied = Buffer.from(suppliedToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");

  if (supplied.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(supplied, expected);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  client: WooCommerceClient,
  upstreamToken: string,
): Promise<void> {
  let pathname: string;

  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    sendJson(res, 400, {
      error: { code: "bad_request", message: "Invalid request URL" },
    });
    return;
  }

  if (pathname === "/healthz" && req.method === "GET") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (pathname !== "/mcp") {
    sendJson(res, 404, {
      error: { code: "not_found", message: "Not found" },
    });
    return;
  }

  // This upstream contract uses POST /mcp; health checks are GET /healthz.
  if (req.method !== "POST") {
    res.writeHead(405, {
      Allow: "POST",
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  if (!tokenMatches(req.headers.authorization, upstreamToken)) {
    req.resume();
    res.writeHead(401, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "WWW-Authenticate": "Bearer",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify({
      error: {
        code: "unauthorized",
        message: "Invalid or missing bearer token",
      },
    }));
    return;
  }

  let mcpServer: McpServer | undefined;

  try {
    // Stateless: a new protocol server and HTTP transport handle each POST.
    mcpServer = new McpServer({
      name: "urumi-woo-mcp",
      version: "0.0.0",
    });

    registerWooCommerceTools(mcpServer, client);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  } catch {
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: {
          code: "internal_error",
          message: "MCP request could not be processed",
        },
      });
    } else if (!res.writableEnded) {
      res.destroy();
    }
  } finally {
    if (mcpServer) {
      try {
        await mcpServer.close();
      } catch {
        // Ignore cleanup errors so they do not leak into client responses.
      }
    }
  }
}

export function createWooMcpHttpServer(config: WooMcpConfig): Server {
  const client = new WooCommerceClient(
    {
      baseUrl: config.baseUrl,
      consumerKey: config.consumerKey,
      consumerSecret: config.consumerSecret,
    },
    config.fetchImpl,
  );

  return createServer((req, res) => {
    void handleRequest(req, res, client, config.upstreamToken).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: {
            code: "internal_error",
            message: "Request could not be processed",
          },
        });
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });
  });
}

function main(): void {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    console.error(
      `woo-mcp cannot start: missing required environment variables: ${missing.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  const port = Number(process.env.PORT ?? "3001");

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("woo-mcp cannot start: PORT must be a valid TCP port");
    process.exitCode = 1;
    return;
  }

  let server: Server;

  try {
    server = createWooMcpHttpServer({
      baseUrl: process.env.WC_BASE_URL!,
      consumerKey: process.env.WC_CONSUMER_KEY!,
      consumerSecret: process.env.WC_CONSUMER_SECRET!,
      upstreamToken: process.env.UPSTREAM_AUTH_TOKEN!,
    });
  } catch {
    console.error("woo-mcp cannot start: WooCommerce configuration is invalid");
    process.exitCode = 1;
    return;
  }

  server.listen(port, "0.0.0.0", () => {
    console.log(`woo-mcp listening on port ${port}`);
  });

  server.on("error", () => {
    console.error("woo-mcp HTTP server encountered an error");
    process.exitCode = 1;
  });
}

// Importing this module in tests must not start a background HTTP listener.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
