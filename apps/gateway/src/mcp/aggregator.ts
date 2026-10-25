import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  CallToolResult,
  ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ObjectId } from "mongodb";

import { writeAuditLog } from "../audit/auditService.js";
import { findActiveApiKey } from "../auth/apiKeyService.js";
import type {
  AuditOutcome,
  AuditSource,
  ServerDocument,
  ServerStatus,
  UserRole,
} from "../db/models.js";
import type { GatewayCollections } from "../db/mongo.js";
import { decryptCredential } from "../crypto/credentials.js";
import {
  buildExposedToolName,
  parseExposedToolName,
} from "./toolNaming.js";
import { isToolAllowedForRole } from "./toolPermissions.js";
import { GatewayToolMetrics } from "../observability/toolMetrics.js";

const DEFAULT_LIST_TIMEOUT_MS = 5_000;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const MAX_TOOL_RESULT_BYTES = 100_000;
const MAX_TOOL_LIST_BYTES = 100_000;
const TOOL_METADATA_CACHE_TTL_MS = 60_000;

export interface GatewayMcpUser {
  userId: ObjectId;
  email: string;
  role: UserRole;
}

export interface UpstreamMcpClient {
  listTools(timeoutMs: number): Promise<ListToolsResult>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<CallToolResult>;
  close(): Promise<void>;
}

export type UpstreamMcpClientFactory = (
  server: ServerDocument,
  connectTimeoutMs: number,
) => Promise<UpstreamMcpClient>;

export interface GatewayAggregatorOptions {
  listTimeoutMs?: number;
  callTimeoutMs?: number;
  credentialEncryptionKey?: string;
  clientFactory?: UpstreamMcpClientFactory;
}

export class UpstreamTimeoutError extends Error {
  constructor() {
    super("Upstream operation timed out");
    this.name = "UpstreamTimeoutError";
  }
}

function positiveTimeout(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

/**
 * Apply one overall deadline to client creation plus the MCP request.
 * Closing the client in the caller's finally block stops timed-out work where
 * possible without leaking the underlying transport.
 */
function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new UpstreamTimeoutError());
    }, timeoutMs);

    void Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

function upstreamHeaders(
  server: ServerDocument,
  encryptionKey?: string,
): Record<string, string> {
  if (server.authType === "none") {
    return {};
  }

  if (!server.credentialEnc) {
    throw new Error("Upstream credential is missing");
  }

  // Decrypt only when constructing this request's upstream client.
  const credential = decryptCredential(server.credentialEnc, encryptionKey);

  if (server.authType === "bearer") {
    return { Authorization: `Bearer ${credential}` };
  }

  if (server.authType === "header" && server.headerName) {
    return { [server.headerName]: credential };
  }

  throw new Error("Upstream authentication configuration is invalid");
}

/**
 * Constructs a fresh SDK client for one upstream operation.
 * Client-facing authorization headers are never accepted as input here;
 * the only upstream credential comes from that server's stored configuration.
 */
async function createSdkUpstreamClient(
  server: ServerDocument,
  encryptionKey: string | undefined,
  connectTimeoutMs: number,
): Promise<UpstreamMcpClient> {
  let transport: StreamableHTTPClientTransport | undefined;
  let client: Client | undefined;

  try {
    transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: {
        headers: upstreamHeaders(server, encryptionKey),
      },
    });

    client = new Client(
      { name: "urumi-gateway", version: "0.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport, { timeout: connectTimeoutMs });

    const connectedClient = client;

    return {
      listTools: (timeoutMs) =>
        connectedClient.listTools(undefined, { timeout: timeoutMs }),

      callTool: async (name, args, timeoutMs): Promise<CallToolResult> => {
        const result = await connectedClient.callTool(
          { name, arguments: args },
          CallToolResultSchema,
          { timeout: timeoutMs },
        );

        // The SDK can return a task-style result without the normal content
        // array. This gateway currently supports ordinary tool results only.
        if (!("content" in result) || !Array.isArray(result.content)) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: "Upstream returned an unsupported task result",
            }],
          };
        }

        // Parse into the SDK's standard tool-result shape. This avoids
        // returning the broader task-capable response union to the gateway.
        const parsedResult = CallToolResultSchema.safeParse(result);

        if (!parsedResult.success) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: "Upstream returned an invalid tool result",
            }],
          };
        }

        return parsedResult.data;
      },

      close: async () => {
        await connectedClient.close();
      },
    };
  } catch {
    if (client) {
      await client.close().catch(() => undefined);
    } else if (transport) {
      await transport.close().catch(() => undefined);
    }

    // Keep URLs, credentials and driver errors out of public responses.
    throw new Error("Upstream connection failed");
  }
}

function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function resultSizeBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Mark text returned by an upstream with its source before exposing it. */
function prefixToolResult(
  result: CallToolResult,
  serverSlug: string,
): CallToolResult {
  return {
    ...result,
    content: result.content.map((item) =>
      item.type === "text"
        ? { ...item, text: `[${serverSlug}] ${item.text}` }
        : item,
    ),
  };
}

type ListedTool = ListToolsResult["tools"][number];

export interface PublicServerTool {
  name: string;
  description: string;
}

interface ToolMetadataCacheEntry {
  tools: PublicServerTool[];
  expiresAt: number;
}

interface DiscoveryResult {
  tools: ListedTool[];
  warning?: string;
}

interface ServerDiscoveryBatch extends DiscoveryResult {
  server: ServerDocument;
}

export class GatewayAggregator {
  private readonly listTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly encryptionKey: string | undefined;
  private readonly clientFactory: UpstreamMcpClientFactory;
  private readonly toolMetadataCache = new Map<string, ToolMetadataCacheEntry>();
  private readonly toolMetrics = new GatewayToolMetrics();

  constructor(
    private readonly collections: GatewayCollections,
    options: GatewayAggregatorOptions = {},
  ) {
    this.listTimeoutMs =
      options.listTimeoutMs ??
      positiveTimeout("UPSTREAM_LIST_TIMEOUT_MS", DEFAULT_LIST_TIMEOUT_MS);

    this.callTimeoutMs =
      options.callTimeoutMs ??
      positiveTimeout("UPSTREAM_CALL_TIMEOUT_MS", DEFAULT_CALL_TIMEOUT_MS);

    this.encryptionKey =
      options.credentialEncryptionKey ??
      process.env.CREDENTIAL_ENCRYPTION_KEY;

    this.clientFactory =
      options.clientFactory ??
      ((server, timeoutMs) =>
        createSdkUpstreamClient(server, this.encryptionKey, timeoutMs));
  }

  renderMetrics(): string {
    return this.toolMetrics.renderPrometheus();
  }

  getCachedTools(
    server: Pick<ServerDocument, "slug" | "enabled" | "status">,
    role: UserRole,
  ): PublicServerTool[] {
    if (!server.enabled || server.status !== "connected") {
      this.invalidateServerTools(server.slug);
      return [];
    }

    const entry = this.toolMetadataCache.get(server.slug);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.invalidateServerTools(server.slug);
      return [];
    }

    return entry.tools
      .filter((tool) => isToolAllowedForRole(role, tool.name))
      .map((tool) => ({ ...tool }));
  }

  invalidateServerTools(serverSlug: string): void {
    this.toolMetadataCache.delete(serverSlug);
  }

  private cacheServerTools(serverSlug: string, tools: ListedTool[]): void {
    this.toolMetadataCache.set(serverSlug, {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
      })),
      expiresAt: Date.now() + TOOL_METADATA_CACHE_TTL_MS,
    });
  }

  /**
   * List tools from connected, enabled servers in parallel.
   * A failed upstream is marked unreachable and does not fail the whole list.
   */
  async listTools(user: GatewayMcpUser): Promise<ListToolsResult> {
    const servers = await this.collections.servers
      .find({ enabled: true, status: "connected" })
      .sort({ slug: 1 })
      .toArray();

    const batches: ServerDiscoveryBatch[] = await Promise.all(
      servers.map(async (server): Promise<ServerDiscoveryBatch> => {
        try {
          const discovered = await this.discoverServerTools(
            server,
            this.listTimeoutMs,
          );

          await this.setServerStatus(
            server,
            "connected",
            discovered.warning,
          );
          this.cacheServerTools(server.slug, discovered.tools);

          return { server, ...discovered };
        } catch (error: unknown) {
          const reason =
            error instanceof UpstreamTimeoutError
              ? "Upstream tool discovery timed out"
              : "Upstream tool discovery failed";

          await this.setServerStatus(server, "unreachable", reason);
          return { server, tools: [] };
        }
      }),
    );

    // Bound the entire response, not only each individual upstream.
    // Count JSON bytes incrementally to avoid repeatedly serializing the
    // full accumulated list. A skipped tool does not block smaller tools
    // from this or later upstreams.
    const tools: ListedTool[] = [];
    const truncatedSlugs = new Set<string>();
    let responseBytes = Buffer.byteLength(JSON.stringify({ tools: [] }), "utf8");

    for (const batch of batches) {
      for (const tool of batch.tools) {
        // Keep cached upstream metadata complete, but filter each caller's
        // public MCP tool list according to their role.
        if (!isToolAllowedForRole(user.role, tool.name)) {
          continue;
        }

        const serialized = JSON.stringify(tool);

        if (serialized === undefined) {
          truncatedSlugs.add(batch.server.slug);
          continue;
        }

        const toolBytes = Buffer.byteLength(serialized, "utf8");
        const extraBytes = toolBytes + (tools.length > 0 ? 1 : 0);

        if (responseBytes + extraBytes > MAX_TOOL_LIST_BYTES) {
          truncatedSlugs.add(batch.server.slug);
          continue;
        }

        tools.push(tool);
        responseBytes += extraBytes;
      }
    }

    for (const batch of batches) {
      if (truncatedSlugs.has(batch.server.slug)) {
        const warnings = [
          batch.warning,
          "warning: aggregated tool list truncated at the 100 KB response limit",
        ].filter((value): value is string => Boolean(value));

        await this.setServerStatus(
          batch.server,
          "connected",
          warnings.join("; "),
        );
      }
    }

    return { tools };
  }

  /**
   * Refresh every server's health. Disabled servers are not contacted.
   * This method is intended for the periodic health loop.
   */
  async refreshAllServerHealth(): Promise<void> {
    const servers = await this.collections.servers
      .find({})
      .sort({ slug: 1 })
      .toArray();

    await Promise.all(
      servers.map(async (server) => {
        if (!server.enabled) {
          await this.setServerStatus(server, "disabled");
          this.invalidateServerTools(server.slug);
          return;
        }

        try {
          const discovered = await this.discoverServerTools(
            server,
            this.listTimeoutMs,
          );

          await this.setServerStatus(
            server,
            "connected",
            discovered.warning,
          );
          this.cacheServerTools(server.slug, discovered.tools);
        } catch (error: unknown) {
          const reason =
            error instanceof UpstreamTimeoutError
              ? "Upstream health check timed out"
              : "Upstream health check failed";

          await this.setServerStatus(server, "unreachable", reason);
        }
      }),
    );
  }

  /**
   * Resolve a public <serverSlug>__<toolName> name and call that upstream.
   * Unknown, disabled and unreachable servers become MCP tool errors rather
   * than JSON-RPC protocol errors.
   */
  async callTool(
    user: GatewayMcpUser,
    source: AuditSource,
    exposedName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const startedAt = Date.now();
    const parsed = parseExposedToolName(exposedName);

    const serverSlug = parsed?.serverSlug ?? "unknown";
    const auditToolName = (
      parsed?.upstreamToolName ?? exposedName
    ).slice(0, 128);

    let outcome: AuditOutcome = "error";
    let response: CallToolResult;

    try {
      if (!parsed) {
        outcome = "denied";
        response = toolError("Invalid gateway tool name");
      } else if (!isToolAllowedForRole(user.role, exposedName)) {
        // Enforce authorization before accessing or connecting to an upstream.
        outcome = "denied";
        response = toolError("Tool is not permitted for this role");
      } else {
        const server = await this.collections.servers.findOne({
          slug: parsed.serverSlug,
        });

        if (
          !server ||
          !server.enabled ||
          server.status !== "connected"
        ) {
          outcome = "denied";
          response = toolError(`server '${parsed.serverSlug}' is unavailable`);
        } else {
          let client: UpstreamMcpClient | undefined;

          try {
            const result = await withTimeout(async () => {
              const elapsed = Date.now() - startedAt;
              const remaining = this.callTimeoutMs - elapsed;

              if (remaining <= 0) {
                throw new UpstreamTimeoutError();
              }

              client = await this.clientFactory(server, remaining);

              const afterConnect =
                this.callTimeoutMs - (Date.now() - startedAt);

              if (afterConnect <= 0) {
                throw new UpstreamTimeoutError();
              }

              return client.callTool(
                parsed.upstreamToolName,
                args,
                afterConnect,
              );
            }, this.callTimeoutMs);

            const labeledResult = prefixToolResult(result, server.slug);

            if (resultSizeBytes(labeledResult) > MAX_TOOL_RESULT_BYTES) {
              outcome = "error";
              response = toolError("Upstream tool result exceeded the 100 KB limit");
            } else {
              response = labeledResult;
              outcome = result.isError ? "error" : "success";
            }
          } catch (error: unknown) {
            const timedOut =
              error instanceof UpstreamTimeoutError ||
              Date.now() - startedAt >= this.callTimeoutMs;

            outcome = timedOut ? "timeout" : "error";

            await this.setServerStatus(
              server,
              "unreachable",
              timedOut
                ? "Upstream tool call timed out"
                : "Upstream tool call failed",
            );

            response = toolError(
              timedOut
                ? "Upstream tool call timed out"
                : "Upstream tool call failed",
            );
          } finally {
            await client?.close().catch(() => undefined);
          }
        }
      }
    } catch {
      outcome = "error";
      response = toolError("Tool call could not be completed");
    }

    this.toolMetrics.recordCall(
      serverSlug,
      outcome,
      Math.max(0, Date.now() - startedAt),
    );

    try {
      await writeAuditLog(this.collections.auditlogs, {
        userId: user.userId,
        userEmail: user.email,
        source,
        serverSlug,
        toolName: auditToolName,
        durationMs: Math.max(0, Date.now() - startedAt),
        outcome,
        args,
      });
    } catch {
      // Never return a tool result silently when its required audit write fails.
      return toolError("Tool result could not be safely returned because audit logging failed");
    }

    return response;
  }

  private async discoverServerTools(
    server: ServerDocument,
    timeoutMs: number,
  ): Promise<DiscoveryResult> {
    const startedAt = Date.now();
    let client: UpstreamMcpClient | undefined;

    try {
      const result = await withTimeout(async () => {
        client = await this.clientFactory(server, timeoutMs);

        const remaining = timeoutMs - (Date.now() - startedAt);
        if (remaining <= 0) {
          throw new UpstreamTimeoutError();
        }

        return client.listTools(remaining);
      }, timeoutMs);

      const tools: ListedTool[] = [];
      let skippedTool = false;

      for (const upstreamTool of result.tools) {
        const built = buildExposedToolName(server.slug, upstreamTool.name);

        if (!built.ok) {
          skippedTool = true;
          continue;
        }

        tools.push({
          ...upstreamTool,
          name: built.name,
          description:
            `[${server.slug}] ${upstreamTool.description ?? ""}`.trimEnd(),
        });
      }

      return {
        tools,
        ...(skippedTool
          ? {
              warning:
                "warning: one or more upstream tool names were omitted because they exceed the 64-character limit or are invalid",
            }
          : {}),
      };
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  private async setServerStatus(
    server: ServerDocument,
    status: ServerStatus,
    statusReason?: string,
  ): Promise<void> {
    if (status !== "connected") {
      this.invalidateServerTools(server.slug);
    }

    try {
      if (statusReason !== undefined) {
        await this.collections.servers.updateOne(
          { _id: server._id },
          {
            $set: {
              status,
              statusReason,
              lastCheckedAt: new Date(),
            },
          },
        );
      } else {
        await this.collections.servers.updateOne(
          { _id: server._id },
          {
            $set: {
              status,
              lastCheckedAt: new Date(),
            },
            $unset: { statusReason: "" },
          },
        );
      }
    } catch {
      // Status refresh is best effort; never expose database errors to MCP clients.
    }
  }
}

/**
 * Authenticate a gateway client key and ensure its owner remains active.
 * The conditional update closes the race between reading the key and a
 * concurrent revocation: revoked keys must not pass this request.
 */
export async function authenticateGatewayApiKey(
  collections: GatewayCollections,
  presentedKey: string | undefined,
): Promise<GatewayMcpUser | null> {
  if (!presentedKey) {
    return null;
  }

  const apiKey = await findActiveApiKey(collections.apikeys, presentedKey);
  if (!apiKey) {
    return null;
  }

  const activeKeyUpdate = await collections.apikeys.updateOne(
    { _id: apiKey._id, hash: apiKey.hash, revokedAt: { $exists: false } },
    { $set: { lastUsedAt: new Date() } },
  );

  if (activeKeyUpdate.matchedCount !== 1) {
    return null;
  }

  const user = await collections.users.findOne({ _id: apiKey.userId });

  if (!user || user.status !== "active") {
    return null;
  }

  return {
    userId: user._id,
    email: user.email,
    role: user.role,
  };
}
