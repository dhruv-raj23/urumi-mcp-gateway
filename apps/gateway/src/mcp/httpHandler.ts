import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { GatewayCollections } from "../db/mongo.js";
import {
  authenticateGatewayApiKey,
  GatewayAggregator,
} from "./aggregator.js";

function sendUnauthorized(response: ServerResponse): void {
  response.statusCode = 401;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("WWW-Authenticate", "Bearer");
  response.end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Unauthorized",
    },
    id: null,
  }));
}

/**
 * Stateless MCP HTTP endpoint.
 *
 * Authenticate every POST, then create a fresh protocol server and transport.
 * Only per-upstream credentials stored by the gateway may be sent upstream.
 */
export async function handleMcpHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  collections: GatewayCollections,
  aggregator: GatewayAggregator,
): Promise<void> {
  const authorization = request.headers.authorization;
  const match = typeof authorization === "string"
    ? /^Bearer (urumi_[a-z0-9]{8}_[A-Za-z0-9_-]{43})$/.exec(authorization)
    : null;

  const user = await authenticateGatewayApiKey(
    collections,
    match?.[1],
  );

  if (!user) {
    request.resume();
    sendUnauthorized(response);
    return;
  }

  const mcpServer = new McpServer({
    name: "urumi-gateway",
    version: "0.0.0",
  });

  mcpServer.registerCapabilities({
    tools: { listChanged: false },
  });

  mcpServer.setRequestHandler(
    ListToolsRequestSchema,
    async () => aggregator.listTools(user),
  );

  mcpServer.setRequestHandler(
    CallToolRequestSchema,
    async (mcpRequest) => {
      const rawArguments = mcpRequest.params.arguments;
      const args: Record<string, unknown> =
        rawArguments !== undefined &&
        rawArguments !== null &&
        typeof rawArguments === "object" &&
        !Array.isArray(rawArguments)
          ? rawArguments as Record<string, unknown>
          : {};

      return aggregator.callTool(
        user,
        "mcp",
        mcpRequest.params.name,
        args,
      );
    },
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(request, response);
  } finally {
    await mcpServer.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}
