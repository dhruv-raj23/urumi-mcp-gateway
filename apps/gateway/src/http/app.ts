import { AuditAccessError, AuditCursorError, listAuditLogPage } from "../audit/auditService.js";
import { acceptInvitation, issueInvitation } from "../auth/invitations.js";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { ObjectId } from "mongodb";
import { z } from "zod";

import { encryptCredential } from "../crypto/credentials.js";

import {
  createUserApiKey,
  listUserApiKeys,
  revokeUserApiKey,
} from "../auth/apiKeyService.js";
import { authenticateUser } from "../auth/authService.js";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionToken,
  readCookie,
  verifySessionToken,
} from "../auth/session.js";
import type { GatewayCollections } from "../db/mongo.js";
import type { ServerDocument, UserDocument } from "../db/models.js";
import { configuredHealthCheckIntervalMs, startHealthLoop } from "../health/healthLoop.js";
import {
  GatewayAggregator,
  type PublicServerTool,
  type UpstreamMcpClientFactory,
} from "../mcp/aggregator.js";
import { handleMcpHttpRequest } from "../mcp/httpHandler.js";
import { ChatAgentError, runChatAgent } from "../chat/agent.js";

const MAX_JSON_BODY_BYTES = 32 * 1024;

const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z
    .string()
    .min(1)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= 72,
      "Password exceeds bcrypt's 72-byte limit",
    ),
}).strict();

const logoutSchema = z.object({}).strict();

const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["member", "admin"]),
}).strict();

const acceptInviteSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().refine(
    (value) => Array.from(value).length >= 12,
    { message: "Password must be at least 12 characters" },
  ).refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    { message: "Password must be at most 72 UTF-8 bytes" },
  ),
}).strict();

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
}).strict();

const disableUserSchema = z.object({
  status: z.literal("disabled"),
}).strict();


const SERVER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,23}$/;
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const FORBIDDEN_CUSTOM_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "accept",
  "connection",
  "transfer-encoding",
]);

function isAllowedServerUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username.length === 0 && parsed.password.length === 0;
  } catch {
    return false;
  }
}

function isAllowedHeaderName(value: string): boolean {
  return HTTP_TOKEN_PATTERN.test(value) &&
    !FORBIDDEN_CUSTOM_HEADERS.has(value.toLowerCase());
}

const serverUrlSchema = z.string().trim().min(1).max(2048).refine(
  isAllowedServerUrl,
  "URL must use HTTP or HTTPS and must not contain embedded credentials",
);
const headerNameSchema = z.string().refine(
  isAllowedHeaderName,
  "headerName must be a valid, permitted HTTP token",
);
const serverCredentialSchema = z.string().min(1).max(4096).refine(
  (value) => !/[\r\n]/.test(value),
  "Credential must not contain CR or LF",
);
const serverAuthTypeSchema = z.enum(["none", "bearer", "header"]);

const createServerSchema = z.object({
  slug: z.string().regex(SERVER_SLUG_PATTERN),
  name: z.string().trim().min(1),
  url: serverUrlSchema,
  authType: serverAuthTypeSchema,
  headerName: headerNameSchema.optional(),
  credential: serverCredentialSchema.optional(),
  enabled: z.boolean().optional(),
}).strict().superRefine((data, context) => {
  if (data.authType === "none") {
    if (data.credential !== undefined) {
      context.addIssue({ code: "custom", path: ["credential"], message: "authType none does not accept a credential" });
    }
    if (data.headerName !== undefined) {
      context.addIssue({ code: "custom", path: ["headerName"], message: "authType none does not accept headerName" });
    }
  } else if (data.authType === "bearer") {
    if (data.credential === undefined) {
      context.addIssue({ code: "custom", path: ["credential"], message: "Bearer authentication requires a credential" });
    }
    if (data.headerName !== undefined) {
      context.addIssue({ code: "custom", path: ["headerName"], message: "Bearer authentication does not use headerName" });
    }
  } else {
    if (data.credential === undefined) {
      context.addIssue({ code: "custom", path: ["credential"], message: "Header authentication requires a credential" });
    }
    if (data.headerName === undefined) {
      context.addIssue({ code: "custom", path: ["headerName"], message: "Header authentication requires headerName" });
    }
  }
});

const patchServerSchema = z.object({
  name: z.string().trim().min(1).optional(),
  url: serverUrlSchema.optional(),
  authType: serverAuthTypeSchema.optional(),
  headerName: headerNameSchema.optional(),
  credential: serverCredentialSchema.optional(),
  enabled: z.boolean().optional(),
}).strict().superRefine((data, context) => {
  if (Object.keys(data).length === 0) {
    context.addIssue({ code: "custom", message: "At least one mutable field is required" });
  }
  if (data.authType === "none" && data.credential !== undefined) {
    context.addIssue({ code: "custom", path: ["credential"], message: "authType none does not accept a credential" });
  }
  if (data.authType === "none" && data.headerName !== undefined) {
    context.addIssue({ code: "custom", path: ["headerName"], message: "authType none does not accept headerName" });
  }
  if (data.authType === "bearer" && data.headerName !== undefined) {
    context.addIssue({ code: "custom", path: ["headerName"], message: "Bearer authentication does not use headerName" });
  }
});

function publicServer(
  server: ServerDocument,
  tools: PublicServerTool[] = [],
) {
  return {
    id: server._id.toHexString(),
    slug: server.slug,
    name: server.name,
    url: server.url,
    authType: server.authType,
    ...(server.headerName === undefined ? {} : { headerName: server.headerName }),
    enabled: server.enabled,
    status: server.status,
    ...(server.statusReason === undefined ? {} : { statusReason: server.statusReason }),
    toolCount: tools.length,
    tools,
    hasCredential: Boolean(server.credentialEnc),
    createdAt: server.createdAt,
  };
}

export interface GatewayHttpConfig {
  sessionSecret: string;
  cookieSecure: boolean;
  /** Optional test injection; production reads CREDENTIAL_ENCRYPTION_KEY from env. */
  credentialEncryptionKey?: string;
  /** Optional upstream client injection for integration tests. */
  clientFactory?: UpstreamMcpClientFactory;
  /** Optional test injection; the health loop is enabled by default. */
  enableHealthLoop?: boolean;
}

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpFailure";
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }

  response.end(JSON.stringify(body));
}

function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(response, status, { error: { code, message } });
}

function isJsonContentType(request: IncomingMessage): boolean {
  const header = request.headers["content-type"];
  if (typeof header !== "string") {
    return false;
  }

  return header.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new HttpFailure(413, "body_too_large", "Request body is too large");
    }

    chunks.push(buffer);
  }

  if (totalBytes === 0) {
    throw new HttpFailure(400, "invalid_json", "A JSON request body is required");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpFailure(400, "invalid_json", "Request body must be valid JSON");
  }
}

function publicIdentity(user: UserDocument) {
  return {
    id: user._id.toHexString(),
    email: user.email,
    role: user.role,
  };
}

/** Return only fields permitted by the member-disable API contract. */
function publicDisabledUser(user: UserDocument) {
  return {
    id: user._id.toHexString(),
    email: user.email,
    role: user.role,
    status: "disabled" as const,
    createdAt: user.createdAt,
  };
}

/** Validate the signed cookie and re-check account status on every request. */
async function getActiveSessionUser(
  request: IncomingMessage,
  collections: GatewayCollections,
  sessionSecret: string,
): Promise<UserDocument | null> {
  const rawCookie = readCookie(request.headers.cookie);
  const payload = verifySessionToken(rawCookie, sessionSecret);

  if (!payload) {
    return null;
  }

  const user = await collections.users.findOne({
    _id: new ObjectId(payload.uid),
  });

  if (!user || user.status !== "active") {
    return null;
  }

  return user;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  collections: GatewayCollections,
  config: GatewayHttpConfig,
  aggregator: GatewayAggregator,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://gateway.local");
  const method = request.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  // Intentionally omitted from the public Ingress. Scrape through an internal
  // path such as kubectl port-forward unless a restricted Prometheus policy is added.
  if (path === "/metrics") {
    if (method !== "GET") {
      request.resume();
      response.setHeader("Allow", "GET");
      sendError(response, 405, "method_not_allowed", "Only GET is supported at /metrics");
      return;
    }

    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      "text/plain; version=0.0.4; charset=utf-8",
    );
    response.setHeader("Cache-Control", "no-store");
    response.end(aggregator.renderMetrics());
    return;
  }

  if (path === "/mcp") {
    if (method !== "POST") {
      request.resume();
      response.setHeader("Allow", "POST");
      sendError(response, 405, "method_not_allowed", "Only POST is supported at /mcp");
      return;
    }

    await handleMcpHttpRequest(request, response, collections, aggregator);
    return;
  }

  // All state-changing REST requests must use JSON, including routes added
  // later. This prevents ordinary HTML form submissions from reaching them.
  if (
    path.startsWith("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    !isJsonContentType(request)
  ) {
    request.resume();
    sendError(
      response,
      415,
      "unsupported_media_type",
      "State-changing API requests must use application/json",
    );
    return;
  }

  if (method === "POST" && path === "/api/auth/accept-invite") {
    const body = await readJsonBody(request);
    const parsed = acceptInviteSchema.safeParse(body);

    if (!parsed.success) {
      sendError(response, 400, "invalid_body", "Invalid invitation request");
      return;
    }

    const accepted = await acceptInvitation(
      collections.users,
      parsed.data.token,
      parsed.data.password,
    );

    if (!accepted) {
      // Unknown, expired, already-used and non-invited tokens share one response.
      sendError(response, 400, "invalid_invitation", "Invitation is invalid or expired");
      return;
    }

    sendJson(response, 200, {
      user: { id: accepted.id, email: accepted.email, role: accepted.role, status: "active" },
    });
    return;
  }

  if (method === "POST" && path === "/api/auth/login") {
    const body = await readJsonBody(request);
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      sendError(response, 400, "invalid_body", "Invalid login request");
      return;
    }

    const principal = await authenticateUser(
      collections.users,
      parsed.data.email,
      parsed.data.password,
    );

    if (!principal) {
      // Identical status and body for unknown email, wrong password,
      // invited accounts, and disabled accounts.
      sendError(response, 401, "invalid_credentials", "Invalid email or password");
      return;
    }

    const token = createSessionToken(principal.id, config.sessionSecret);

    sendJson(
      response,
      200,
      {
        user: {
          id: principal.id,
          email: principal.email,
          role: principal.role,
        },
      },
      {
        "Set-Cookie": buildSessionCookie(token, config.cookieSecure),
      },
    );
    return;
  }

  if (method === "POST" && path === "/api/auth/logout") {
    const body = await readJsonBody(request);

    if (!logoutSchema.safeParse(body).success) {
      sendError(response, 400, "invalid_body", "Invalid logout request");
      return;
    }

    sendJson(
      response,
      200,
      { status: "ok" },
      {
        "Set-Cookie": buildClearedSessionCookie(config.cookieSecure),
      },
    );
    return;
  }

  if (method === "GET" && path === "/api/auth/me") {
    const user = await getActiveSessionUser(
      request,
      collections,
      config.sessionSecret,
    );

    if (!user) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }

    sendJson(response, 200, { user: publicIdentity(user) });
    return;
  }

  if (method === "POST" && path === "/api/chat") {
    const user = await getActiveSessionUser(
      request,
      collections,
      config.sessionSecret,
    );

    if (!user) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }

    // Identity always comes from the verified session, never client JSON.
    const body = await readJsonBody(request);

    try {
      const result = await runChatAgent(
        {
          userId: user._id,
          email: user.email,
          role: user.role,
        },
        body,
        aggregator,
      );
      sendJson(response, 200, result);
    } catch (error: unknown) {
      if (error instanceof ChatAgentError) {
        sendError(response, error.status, error.code, error.message);
        return;
      }

      // Do not expose provider errors, request headers, message bodies, or secrets.
      sendError(
        response,
        503,
        "chat_unavailable",
        "The chat service is temporarily unavailable. Please try again.",
      );
    }
    return;
  }

  if (method === "POST" && path === "/api/users/invite") {
    const user = await getActiveSessionUser(
      request,
      collections,
      config.sessionSecret,
    );

    if (!user) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }

    if (user.role !== "admin") {
      sendError(response, 403, "forbidden", "Administrator access required");
      return;
    }

    const body = await readJsonBody(request);
    const parsed = inviteUserSchema.safeParse(body);
    if (!parsed.success) {
      sendError(response, 400, "invalid_body", "Invalid invitation request");
      return;
    }

    const result = await issueInvitation(
      collections.users,
      parsed.data.email,
      parsed.data.role,
    );

    if (result.kind === "active-conflict") {
      sendError(response, 409, "user_already_active", "This email already belongs to an active user");
      return;
    }
    if (result.kind === "state-conflict") {
      sendError(response, 409, "user_invitation_conflict", "This user cannot be invited");
      return;
    }

    const invitation = result.invitation;
    // The plaintext invite token is returned once only; never log this body.
    sendJson(
      response,
      201,
      {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: "invited",
          expiresAt: invitation.expiresAt.toISOString(),
        },
        token: invitation.token,
      },
      { "Cache-Control": "no-store" },
    );
    return;
  }

  if (method === "GET" && path === "/api/users") {
    const user = await getActiveSessionUser(
      request,
      collections,
      config.sessionSecret,
    );

    if (!user) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }

    if (user.role !== "admin") {
      sendError(response, 403, "forbidden", "Administrator role required");
      return;
    }

    const users = await collections.users
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    sendJson(response, 200, {
      users: users.map((entry) => ({
        ...publicIdentity(entry),
        status: entry.status,
        createdAt: entry.createdAt,
      })),
    });
    return;
  }

  const patchUserMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (method === "PATCH" && patchUserMatch) {
    const actor = await getActiveSessionUser(
      request,
      collections,
      config.sessionSecret,
    );

    if (!actor) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }

    if (actor.role !== "admin") {
      sendError(response, 403, "forbidden", "Administrator access required");
      return;
    }

    const rawUserId = patchUserMatch[1];
    if (!rawUserId || !/^[a-fA-F0-9]{24}$/.test(rawUserId)) {
      sendError(response, 400, "invalid_user_id", "User ID must be a 24-character ObjectId");
      return;
    }

    const parsed = disableUserSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      sendError(response, 400, "invalid_body", "Invalid member-disable request");
      return;
    }

    const targetId = new ObjectId(rawUserId);
    const target = await collections.users.findOne({ _id: targetId });

    if (!target) {
      sendError(response, 404, "user_not_found", "User not found");
      return;
    }

    if (target.role !== "member") {
      sendError(
        response,
        409,
        "user_not_disableable",
        "Administrator accounts cannot be disabled through this endpoint",
      );
      return;
    }

    if (target.status === "disabled") {
      sendJson(response, 200, { user: publicDisabledUser(target) });
      return;
    }

    const update = await collections.users.updateOne(
      {
        _id: targetId,
        role: "member",
        status: target.status,
      },
      {
        $set: { status: "disabled" },
        $unset: { inviteTokenHash: "", inviteExpiresAt: "" },
      },
    );

    if (update.matchedCount === 0) {
      // Another request may have changed the user since the initial read.
      const current = await collections.users.findOne({ _id: targetId });

      if (!current) {
        sendError(response, 404, "user_not_found", "User not found");
        return;
      }

      if (current.role === "member" && current.status === "disabled") {
        sendJson(response, 200, { user: publicDisabledUser(current) });
        return;
      }

      sendError(
        response,
        409,
        "user_state_conflict",
        "User state changed; refresh the user list and retry",
      );
      return;
    }

    sendJson(response, 200, { user: publicDisabledUser(target) });
    return;
  }

  if (method === "GET" && path === "/api/servers") {
    const user = await getActiveSessionUser(request, collections, config.sessionSecret);
    if (!user) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }

    const servers = await collections.servers.find({}).sort({ slug: 1 }).toArray();
    sendJson(response, 200, {
      servers: servers.map((server) =>
        publicServer(server, aggregator.getCachedTools(server, user.role)),
      ),
    });
    return;
  }

  if (method === "POST" && path === "/api/servers") {
    const user = await getActiveSessionUser(request, collections, config.sessionSecret);
    if (!user) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }
    if (user.role !== "admin") {
      sendError(response, 403, "forbidden", "Administrator access required");
      return;
    }

    const body = await readJsonBody(request);
    const parsed = createServerSchema.safeParse(body);
    if (!parsed.success) {
      sendError(response, 400, "invalid_body", "Invalid server configuration");
      return;
    }

    const input = parsed.data;
    const enabled = input.enabled ?? true;
    const document: ServerDocument = {
      _id: new ObjectId(),
      slug: input.slug,
      name: input.name,
      url: input.url,
      authType: input.authType,
      enabled,
      status: enabled ? "unreachable" : "disabled",
      statusReason: enabled ? "not checked yet" : "disabled",
      createdAt: new Date(),
      ...(input.headerName === undefined ? {} : { headerName: input.headerName }),
      ...(input.credential === undefined ? {} : {
        credentialEnc: encryptCredential(input.credential, config.credentialEncryptionKey),
      }),
    };

    try {
      await collections.servers.insertOne(document);
    } catch (error) {
      if (typeof error === "object" && error !== null &&
          "code" in error && (error as { code?: unknown }).code === 11000) {
        sendError(response, 409, "server_slug_conflict", "A server with this slug already exists");
        return;
      }
      throw error;
    }

    sendJson(response, 201, { server: publicServer(document) });
    return;
  }

  const serverPathMatch = /^\/api\/servers\/([^/]+)$/.exec(path);
  if (serverPathMatch && (method === "PATCH" || method === "DELETE")) {
    const user = await getActiveSessionUser(request, collections, config.sessionSecret);
    if (!user) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }
    if (user.role !== "admin") {
      sendError(response, 403, "forbidden", "Administrator access required");
      return;
    }

    const idText = serverPathMatch[1] ?? "";
    if (!/^[a-f0-9]{24}$/i.test(idText)) {
      sendError(response, 400, "invalid_server_id", "Server ID must be a valid ObjectId");
      return;
    }
    const serverId = new ObjectId(idText);
    const existing = await collections.servers.findOne({ _id: serverId });
    if (!existing) {
      sendError(response, 404, "server_not_found", "Server not found");
      return;
    }

    if (method === "DELETE") {
      request.resume();
      const deleted = await collections.servers.deleteOne({ _id: serverId });
      if (deleted.deletedCount !== 1) {
        sendError(response, 404, "server_not_found", "Server not found");
        return;
      }
      aggregator.invalidateServerTools(existing.slug);
      sendJson(response, 200, { status: "deleted" });
      return;
    }

    const body = await readJsonBody(request);
    const parsed = patchServerSchema.safeParse(body);
    if (!parsed.success) {
      sendError(response, 400, "invalid_body", "Invalid server update");
      return;
    }

    const input = parsed.data;
    const authType = input.authType ?? existing.authType;
    const credentialProvided = input.credential !== undefined;
    const headerNameProvided = input.headerName !== undefined;

    if (authType === "none" && (credentialProvided || headerNameProvided)) {
      sendError(response, 400, "invalid_auth_configuration", "No-auth servers cannot have credentials or headerName");
      return;
    }
    if (authType !== "header" && headerNameProvided) {
      sendError(response, 400, "invalid_auth_configuration", "headerName is only valid for header authentication");
      return;
    }
    if (existing.authType === "none" && authType !== "none" && !credentialProvided) {
      sendError(response, 400, "credential_required", "Changing from none authentication requires a credential in the same request");
      return;
    }

    let credentialEnc = credentialProvided
      ? encryptCredential(input.credential as string, config.credentialEncryptionKey)
      : existing.credentialEnc;
    let headerName: string | undefined;

    if (authType === "header") {
      headerName = input.headerName ?? existing.headerName;
      if (!headerName) {
        sendError(response, 400, "header_name_required", "Header authentication requires headerName");
        return;
      }
    } else if (authType === "bearer") {
      headerName = undefined;
    } else {
      credentialEnc = undefined;
      headerName = undefined;
    }

    if (authType !== "none" && !credentialEnc) {
      sendError(response, 400, "credential_required", "This authentication type requires a credential");
      return;
    }

    const enabled = input.enabled ?? existing.enabled;
    const transitionedToEnabled = enabled && !existing.enabled;
    const discoveryConfigChanged =
      input.url !== undefined ||
      input.authType !== undefined ||
      credentialProvided ||
      headerNameProvided;
    const status = !enabled ? "disabled" :
      transitionedToEnabled || discoveryConfigChanged
        ? "unreachable"
        : existing.status;
    const statusReason = !enabled ? "disabled" :
      transitionedToEnabled ? "not checked yet" :
      discoveryConfigChanged ? "configuration changed; health check pending" :
      existing.statusReason;
    const setValues: Partial<ServerDocument> = {
      name: input.name ?? existing.name,
      url: input.url ?? existing.url,
      authType,
      enabled,
      status,
    };
    if (statusReason !== undefined) setValues.statusReason = statusReason;
    if (credentialEnc !== undefined) setValues.credentialEnc = credentialEnc;
    if (headerName !== undefined) setValues.headerName = headerName;

    const unsetFields: { credentialEnc?: ""; headerName?: ""; statusReason?: "" } = {};
    if (authType === "none") {
      unsetFields.credentialEnc = "";
      unsetFields.headerName = "";
      delete setValues.credentialEnc;
      delete setValues.headerName;
    } else if (authType === "bearer") {
      unsetFields.headerName = "";
      delete setValues.headerName;
    }
    if (statusReason === undefined) unsetFields.statusReason = "";

    const updatedResult = await collections.servers.updateOne(
      { _id: serverId },
      { $set: setValues, $unset: unsetFields },
    );
    if (updatedResult.matchedCount !== 1) {
      sendError(response, 404, "server_not_found", "Server not found");
      return;
    }
    const updated = await collections.servers.findOne({ _id: serverId });
    if (!updated) {
      sendError(response, 404, "server_not_found", "Server not found");
      return;
    }
    if (!enabled || transitionedToEnabled || discoveryConfigChanged) {
      aggregator.invalidateServerTools(existing.slug);
    }
    sendJson(response, 200, {
      server: publicServer(updated, aggregator.getCachedTools(updated, user.role)),
    });
    return;
  }

  if (method === "POST" && path === "/api/keys") {
    const user = await getActiveSessionUser(
      request,
      collections,
      config.sessionSecret,
    );

    if (!user) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }

    const body = await readJsonBody(request);
    const parsed = createApiKeySchema.safeParse(body);

    if (!parsed.success) {
      sendError(response, 400, "invalid_body", "Invalid API key request");
      return;
    }

    // The owner is always the authenticated principal. Clients cannot
    // select another user, including when the principal is an admin.
    const created = await createUserApiKey(
      collections.apikeys,
      user._id,
      parsed.data.name,
    );

    // This is the only response that contains the full secret.
    // Do not log request or response bodies.
    sendJson(
      response,
      201,
      {
        key: created.key,
        apiKey: {
          id: created.apiKey.id,
          name: created.apiKey.name,
          prefix: created.apiKey.prefix,
          createdAt: created.apiKey.createdAt,
        },
      },
      { "Cache-Control": "no-store" },
    );
    return;
  }

  if (method === "GET" && path === "/api/keys") {
    const user = await getActiveSessionUser(
      request,
      collections,
      config.sessionSecret,
    );

    if (!user) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }

    const requestedUserId = url.searchParams.get("userId");

    if (
      requestedUserId !== null &&
      !/^[a-f0-9]{24}$/i.test(requestedUserId)
    ) {
      sendError(response, 400, "invalid_user_id", "userId must be a valid ObjectId");
      return;
    }

    // Members may only list their own keys, even if they change the query.
    if (
      user.role !== "admin" &&
      requestedUserId !== null &&
      requestedUserId.toLowerCase() !== user._id.toHexString()
    ) {
      sendError(response, 403, "forbidden", "Cannot list another user's API keys");
      return;
    }

    const targetUserId =
      requestedUserId === null ? undefined : new ObjectId(requestedUserId);

    const keys = await listUserApiKeys(
      collections.apikeys,
      { userId: user._id, role: user.role },
      targetUserId,
    );

    sendJson(response, 200, { keys });
    return;
  }

  if (method === "GET" && path === "/api/audit") {
    const user = await getActiveSessionUser(
      request,
      collections,
      config.sessionSecret,
    );

    if (!user) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }

    const limitText = url.searchParams.get("limit");
    let limit = 50;
    if (limitText !== null) {
      if (!/^\d+$/.test(limitText)) {
        sendError(response, 400, "invalid_limit", "limit must be an integer from 1 to 100");
        return;
      }
      const parsedLimit = Number(limitText);
      if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        sendError(response, 400, "invalid_limit", "limit must be an integer from 1 to 100");
        return;
      }
      limit = parsedLimit;
    }

    const requestedUserId = url.searchParams.get("userId");
    if (requestedUserId !== null && !/^[a-f0-9]{24}$/i.test(requestedUserId)) {
      sendError(response, 400, "invalid_user_id", "userId must be a valid ObjectId");
      return;
    }

    // A member's explicit cross-user request is denied before cursor parsing.
    if (
      user.role !== "admin" &&
      requestedUserId !== null &&
      requestedUserId.toLowerCase() !== user._id.toHexString()
    ) {
      sendError(response, 403, "forbidden", "Cannot read another user's audit entries");
      return;
    }

    const serverFilter = url.searchParams.get("server");
    if (serverFilter !== null && !/^[a-z0-9][a-z0-9-]{1,23}$/.test(serverFilter)) {
      sendError(response, 400, "invalid_server", "server must be a valid server slug");
      return;
    }

    const outcomeFilter = url.searchParams.get("outcome");
    const validOutcomes = ["success", "error", "timeout", "denied"] as const;
    if (
      outcomeFilter !== null &&
      !validOutcomes.some((outcome) => outcome === outcomeFilter)
    ) {
      sendError(response, 400, "invalid_outcome", "outcome is invalid");
      return;
    }

    const cursor = url.searchParams.has("cursor")
      ? url.searchParams.get("cursor") ?? ""
      : undefined;

    try {
      const page = await listAuditLogPage(
        collections.auditlogs,
        { userId: user._id, role: user.role },
        {
          limit,
          ...(requestedUserId !== null ? { userId: new ObjectId(requestedUserId) } : {}),
          ...(serverFilter !== null ? { server: serverFilter } : {}),
          ...(outcomeFilter !== null ? { outcome: outcomeFilter as "success" | "error" | "timeout" | "denied" } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
        },
        config.sessionSecret,
      );

      // Build an explicit public projection. Unexpected persisted fields can
      // never cause a credential, key, invite token, or raw argument to leak.
      const items = page.items.map((entry) => ({
        id: entry._id.toHexString(),
        ts: entry.ts.toISOString(),
        userId: entry.userId.toHexString(),
        userEmail: entry.userEmail,
        source: entry.source,
        serverSlug: entry.serverSlug,
        toolName: entry.toolName,
        durationMs: entry.durationMs,
        outcome: entry.outcome,
        ...(entry.errorMessage !== undefined ? { errorMessage: entry.errorMessage } : {}),
      }));
      sendJson(response, 200, { items, nextCursor: page.nextCursor });
    } catch (error) {
      if (error instanceof AuditAccessError) {
        sendError(response, 403, "forbidden", "Cannot read another user's audit entries");
        return;
      }
      if (error instanceof AuditCursorError) {
        sendError(response, 400, "invalid_cursor", "Audit cursor is invalid");
        return;
      }
      throw error;
    }
    return;
  }

  const keyPathMatch = /^\/api\/keys\/([^/]+)$/.exec(path);

  if (method === "DELETE" && keyPathMatch) {
    const user = await getActiveSessionUser(
      request,
      collections,
      config.sessionSecret,
    );

    if (!user) {
      sendError(response, 401, "unauthenticated", "Authentication required");
      return;
    }

    // No request body is needed to revoke a key. Drain any supplied body.
    request.resume();

    const keyIdText = keyPathMatch[1] ?? "";

    if (!/^[a-f0-9]{24}$/i.test(keyIdText)) {
      sendError(response, 400, "invalid_key_id", "API key ID must be a valid ObjectId");
      return;
    }

    const revoked = await revokeUserApiKey(
      collections.apikeys,
      new ObjectId(keyIdText),
      { userId: user._id, role: user.role },
    );

    // Do not disclose whether another member owns a particular key.
    if (!revoked) {
      sendError(response, 404, "not_found", "API key not found");
      return;
    }

    sendJson(response, 200, { status: "revoked" });
    return;
  }

  sendError(response, 404, "not_found", "Route not found");
}

/**
 * Creates a testable HTTP server. The entry point provides real MongoDB
 * collections and configuration when starting the application.
 */
export function createGatewayServer(
  collections: GatewayCollections,
  config: GatewayHttpConfig,
): Server {
  if (!config.sessionSecret.trim()) {
    throw new Error("SESSION_SECRET is required");
  }

  const aggregator = new GatewayAggregator(collections, {
    credentialEncryptionKey: config.credentialEncryptionKey,
    ...(config.clientFactory === undefined
      ? {}
      : { clientFactory: config.clientFactory }),
  });
  const healthIntervalMs = configuredHealthCheckIntervalMs();

  const server = createServer((request, response) => {
    void handleRequest(request, response, collections, config, aggregator).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }

      if (error instanceof HttpFailure) {
        sendError(response, error.status, error.code, error.message);
        return;
      }

      // Avoid logging raw driver errors, request bodies, cookies, or secrets.
      sendError(response, 500, "internal_error", "Internal server error");
    });
  });

  let stopHealthLoop: (() => void) | undefined;

  server.once("listening", () => {
    if (config.enableHealthLoop === false) {
      return;
    }
    stopHealthLoop = startHealthLoop(aggregator, healthIntervalMs);
  });

  server.once("close", () => {
    stopHealthLoop?.();
  });

  return server;
}
