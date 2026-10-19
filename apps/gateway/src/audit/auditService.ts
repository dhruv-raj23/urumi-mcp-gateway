import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  type Collection,
  type Filter,
  ObjectId,
} from "mongodb";

import type {
  AuditLogDocument,
  AuditOutcome,
  AuditSource,
  UserRole,
} from "../db/models.js";

export interface AuditEntryInput {
  userId: ObjectId;
  userEmail: string;
  source: AuditSource;
  serverSlug: string;
  toolName: string;
  durationMs: number;
  outcome: AuditOutcome;
  /** Used only to compute argsHash; never stored verbatim. */
  args: unknown;
}

export interface AuditActor {
  userId: ObjectId;
  role: UserRole;
}

export interface AuditFilters {
  limit: number;
  userId?: ObjectId;
  server?: string;
  outcome?: AuditOutcome;
}

export class AuditAccessError extends Error {
  constructor() {
    super("Not authorized to read these audit entries");
    this.name = "AuditAccessError";
  }
}

/**
 * Hashes the supplied arguments without persisting them.
 * Raw exceptions are intentionally excluded from this API because they may
 * contain credentials, headers, or sensitive upstream response data.
 */
export async function writeAuditLog(
  collection: Collection<AuditLogDocument>,
  input: AuditEntryInput,
): Promise<void> {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
    throw new Error("Audit duration must be a non-negative number");
  }

  let serializedArgs: string | undefined;

  try {
    serializedArgs = JSON.stringify(input.args ?? null);
  } catch {
    throw new Error("Audit arguments must be JSON serializable");
  }

  if (serializedArgs === undefined) {
    throw new Error("Audit arguments must be JSON serializable");
  }

  const argsHash = createHash("sha256")
    .update(serializedArgs, "utf8")
    .digest("hex");

  await collection.insertOne({
    _id: new ObjectId(),
    ts: new Date(),
    userId: input.userId,
    userEmail: input.userEmail,
    source: input.source,
    serverSlug: input.serverSlug,
    toolName: input.toolName,
    durationMs: input.durationMs,
    outcome: input.outcome,
    argsHash,
  });
}

/**
 * Members can only read their own audit records. Admins can optionally
 * filter by any user's ID. `limit` is validated here; HTTP defaults and
 * cursor handling will be added after the contract question is resolved.
 */
export async function listAuditLogs(
  collection: Collection<AuditLogDocument>,
  actor: AuditActor,
  filters: AuditFilters,
): Promise<AuditLogDocument[]> {
  if (!Number.isSafeInteger(filters.limit) || filters.limit < 1) {
    throw new Error("Audit limit must be a positive integer");
  }

  if (
    actor.role !== "admin" &&
    filters.userId &&
    !filters.userId.equals(actor.userId)
  ) {
    throw new AuditAccessError();
  }

  const query: Filter<AuditLogDocument> = {};

  if (actor.role !== "admin") {
    query.userId = actor.userId;
  } else if (filters.userId) {
    query.userId = filters.userId;
  }

  if (filters.server) {
    query.serverSlug = filters.server;
  }

  if (filters.outcome) {
    query.outcome = filters.outcome;
  }

  return collection
    .find(query)
    .sort({ ts: -1, _id: -1 })
    .limit(filters.limit)
    .toArray();
}

export interface AuditPageFilters extends AuditFilters {
  cursor?: string;
}

export interface AuditLogPage {
  items: AuditLogDocument[];
  nextCursor: string | null;
}

export class AuditCursorError extends Error {
  constructor() {
    super("Audit cursor is invalid");
    this.name = "AuditCursorError";
  }
}

interface AuditCursorPayload {
  ts: string;
  id: string;
}

function encodeBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/** Signs a canonical timestamp/ObjectId payload with the existing session secret. */
function createAuditCursor(
  entry: Pick<AuditLogDocument, "ts" | "_id">,
  sessionSecret: string,
): string {
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required for audit cursors");
  }

  const payload = encodeBase64Url(JSON.stringify({
    ts: entry.ts.toISOString(),
    id: entry._id.toHexString(),
  } satisfies AuditCursorPayload));
  const signature = createHmac("sha256", sessionSecret)
    .update(payload, "ascii")
    .digest("base64url");

  return `${payload}.${signature}`;
}

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AuditCursorError();
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new AuditCursorError();
  }
  return decoded;
}

function parseAuditCursor(
  cursor: string,
  sessionSecret: string,
): { ts: Date; id: ObjectId } {
  const parts = cursor.split(".");
  if (parts.length !== 2 || !sessionSecret) {
    throw new AuditCursorError();
  }

  const payloadPart = parts[0] ?? "";
  const signaturePart = parts[1] ?? "";
  const suppliedSignature = decodeCanonicalBase64Url(signaturePart);
  const expectedSignature = createHmac("sha256", sessionSecret)
    .update(payloadPart, "ascii")
    .digest();

  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new AuditCursorError();
  }

  // Do not parse or trust payload data until its signature has been verified.
  const payloadText = decodeCanonicalBase64Url(payloadPart).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText) as unknown;
  } catch {
    throw new AuditCursorError();
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new AuditCursorError();
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 2 ||
    typeof candidate.ts !== "string" ||
    typeof candidate.id !== "string" ||
    !/^[a-f0-9]{24}$/.test(candidate.id)
  ) {
    throw new AuditCursorError();
  }

  // Require the exact compact key order and canonical ISO timestamp emitted above.
  if (JSON.stringify({ ts: candidate.ts, id: candidate.id }) !== payloadText) {
    throw new AuditCursorError();
  }

  const timestamp = new Date(candidate.ts);
  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString() !== candidate.ts
  ) {
    throw new AuditCursorError();
  }

  return { ts: timestamp, id: new ObjectId(candidate.id) };
}

/**
 * Stable, signed cursor pagination. Member scope is applied independently of
 * cursor contents, so a cursor can never widen the caller's user scope.
 */
export async function listAuditLogPage(
  collection: Collection<AuditLogDocument>,
  actor: AuditActor,
  filters: AuditPageFilters,
  sessionSecret: string,
): Promise<AuditLogPage> {
  if (
    !Number.isSafeInteger(filters.limit) ||
    filters.limit < 1 ||
    filters.limit > 100
  ) {
    throw new Error("Audit limit must be an integer between 1 and 100");
  }

  if (
    actor.role !== "admin" &&
    filters.userId &&
    !filters.userId.equals(actor.userId)
  ) {
    throw new AuditAccessError();
  }

  const query: Filter<AuditLogDocument> = {};
  if (actor.role !== "admin") {
    query.userId = actor.userId;
  } else if (filters.userId) {
    query.userId = filters.userId;
  }

  if (filters.server) query.serverSlug = filters.server;
  if (filters.outcome) query.outcome = filters.outcome;

  if (filters.cursor !== undefined) {
    let cursor: { ts: Date; id: ObjectId };
    try {
      cursor = parseAuditCursor(filters.cursor, sessionSecret);
    } catch (error) {
      if (error instanceof AuditCursorError) throw error;
      throw new AuditCursorError();
    }
    query.$or = [
      { ts: { $lt: cursor.ts } },
      { ts: cursor.ts, _id: { $lt: cursor.id } },
    ];
  }

  const fetched = await collection
    .find(query)
    .sort({ ts: -1, _id: -1 })
    .limit(filters.limit + 1)
    .toArray();
  const hasMore = fetched.length > filters.limit;
  const items = fetched.slice(0, filters.limit);
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? createAuditCursor(last, sessionSecret) : null,
  };
}
