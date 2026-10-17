import { createServer, type Server, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createWooMcpHttpServer } from "../src/index.js";

const UPSTREAM_TOKEN = "test-upstream-token";
const CONSUMER_KEY = "test-consumer-key";
const CONSUMER_SECRET = "test-consumer-secret-SENTINEL";

interface RecordedRequest {
  method: string;
  pathname: string;
  search: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

let mockWooServer: Server;
let mcpHttpServer: Server;
let mockWooUrl: string;
let mcpUrl: string;
let client: Client | undefined;
let requests: RecordedRequest[];
let forceProductError: boolean;

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("Test server did not bind to a TCP port"));
        return;
      }

      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function respondJson(
  res: import("node:http").ServerResponse,
  status: number,
  value: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

async function connectMcp(token = UPSTREAM_TOKEN): Promise<Client> {
  const newClient = new Client({
    name: "woo-mcp-test-client",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });

  await newClient.connect(transport);
  client = newClient;
  return newClient;
}

function resultText(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return result.content
    .map((item) => (item.type === "text" ? item.text ?? "" : ""))
    .join("\n");
}

beforeEach(async () => {
  requests = [];
  forceProductError = false;

  mockWooServer = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url ?? "/", "http://mock-woo.local");

    requests.push({
      method: req.method ?? "",
      pathname: url.pathname,
      search: url.search,
      headers: req.headers,
      body,
    });

    if (forceProductError && url.pathname.endsWith("/products")) {
      respondJson(res, 403, {
        message: `upstream secret ${CONSUMER_SECRET} SENTINEL`,
      });
      return;
    }

    if (url.pathname === "/wp-json/wc/v3/products" && req.method === "GET") {
      respondJson(res, 200, [{ id: 7, name: "Coffee" }]);
      return;
    }

    if (url.pathname === "/wp-json/wc/v3/products" && req.method === "POST") {
      const payload = body as { name?: string; regular_price?: string; status?: string };
      respondJson(res, 201, {
        id: 99,
        name: payload.name,
        regular_price: payload.regular_price,
        status: payload.status,
      });
      return;
    }

    if (url.pathname === "/wp-json/wc/v3/orders" && req.method === "GET") {
      respondJson(res, 200, [{ id: 42, status: "processing" }]);
      return;
    }

    if (url.pathname === "/wp-json/wc/v3/orders/42" && req.method === "GET") {
      respondJson(res, 200, { id: 42, status: "processing" });
      return;
    }

    if (url.pathname === "/wp-json/wc/v3/orders/42" && req.method === "PUT") {
      const payload = body as { status?: string };
      respondJson(res, 200, { id: 42, status: payload.status });
      return;
    }

    respondJson(res, 404, { message: "Mock endpoint not found" });
  });

  mockWooUrl = await listen(mockWooServer);

  mcpHttpServer = createWooMcpHttpServer({
    baseUrl: mockWooUrl,
    consumerKey: CONSUMER_KEY,
    consumerSecret: CONSUMER_SECRET,
    upstreamToken: UPSTREAM_TOKEN,
  });

  mcpUrl = await listen(mcpHttpServer);
});

afterEach(async () => {
  if (client) {
    try {
      await client.close();
    } catch {
      // Client cleanup should not mask the test result.
    }
    client = undefined;
  }

  await closeServer(mcpHttpServer);
  await closeServer(mockWooServer);
});

describe("woo-mcp HTTP API", () => {
  it("serves an unauthenticated health endpoint", async () => {
    const response = await fetch(`${mcpUrl}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("rejects missing and incorrect bearer tokens", async () => {
    for (const headers of [
      { "Content-Type": "application/json" },
      {
        "Content-Type": "application/json",
        Authorization: "Bearer incorrect-token",
      },
    ]) {
      const response = await fetch(`${mcpUrl}/mcp`, {
        method: "POST",
        headers,
        body: "{}",
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");

      const body = await response.text();
      expect(body).not.toContain(UPSTREAM_TOKEN);
      expect(body).not.toContain(CONSUMER_SECRET);
    }
  });

  it("returns 404 for unknown routes", async () => {
    const response = await fetch(`${mcpUrl}/not-a-route`);
    expect(response.status).toBe(404);
  });

  it("lists the five tools and routes calls to WooCommerce REST v3", async () => {
    const mcpClient = await connectMcp();
    const listing = await mcpClient.listTools();

    expect(listing.tools.map((tool) => tool.name).sort()).toEqual([
      "create_product",
      "get_order",
      "list_orders",
      "list_products",
      "update_order_status",
    ]);

    const products = await mcpClient.callTool({
      name: "list_products",
      arguments: { search: "coffee", per_page: 2 },
    });
    expect(products.isError).not.toBe(true);
    expect(JSON.parse(resultText(products))).toEqual([
      { id: 7, name: "Coffee" },
    ]);

    const created = await mcpClient.callTool({
      name: "create_product",
      arguments: { name: "Test Tea", price: 12.5 },
    });
    expect(created.isError).not.toBe(true);
    expect(JSON.parse(resultText(created))).toMatchObject({
      id: 99,
      name: "Test Tea",
      regular_price: "12.5",
      status: "publish",
    });

    const orders = await mcpClient.callTool({
      name: "list_orders",
      arguments: {
        after: "2026-10-17T00:00:00Z",
        status: "processing",
        per_page: 10,
      },
    });
    expect(orders.isError).not.toBe(true);
    expect(JSON.parse(resultText(orders))).toEqual([
      { id: 42, status: "processing" },
    ]);

    const order = await mcpClient.callTool({
      name: "get_order",
      arguments: { id: 42 },
    });
    expect(order.isError).not.toBe(true);
    expect(JSON.parse(resultText(order))).toMatchObject({
      id: 42,
      status: "processing",
    });

    const updated = await mcpClient.callTool({
      name: "update_order_status",
      arguments: { id: 42, status: "completed" },
    });
    expect(updated.isError).not.toBe(true);
    expect(JSON.parse(resultText(updated))).toMatchObject({
      id: 42,
      status: "completed",
    });

    expect(requests.map((request) => `${request.method} ${request.pathname}`)).toEqual([
      "GET /wp-json/wc/v3/products",
      "POST /wp-json/wc/v3/products",
      "GET /wp-json/wc/v3/orders",
      "GET /wp-json/wc/v3/orders/42",
      "PUT /wp-json/wc/v3/orders/42",
    ]);

    const listOrdersRequest = requests.find(
      (request) => request.pathname === "/wp-json/wc/v3/orders",
    );
    expect(new URLSearchParams(listOrdersRequest?.search).get("after"))
      .toBe("2026-10-17T00:00:00Z");
    expect(new URLSearchParams(listOrdersRequest?.search).get("status"))
      .toBe("processing");

    for (const request of requests) {
      expect(request.headers.authorization).toBe(
        `Basic ${Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64")}`,
      );
      expect(request.headers["x-forwarded-proto"]).toBe("https");
    }
  });

  it("does not leak upstream response content through tool errors", async () => {
    forceProductError = true;
    const mcpClient = await connectMcp();

    const result = await mcpClient.callTool({
      name: "list_products",
      arguments: {},
    });

    expect(result.isError).toBe(true);

    const output = resultText(result);
    expect(output).toContain("HTTP 403");
    expect(output).not.toContain(CONSUMER_SECRET);
    expect(output).not.toContain("SENTINEL");
  });
});
