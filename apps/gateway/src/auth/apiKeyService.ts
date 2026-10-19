import { ObjectId, type Collection } from "mongodb";

import type { ApiKeyDocument, UserRole } from "../db/models.js";
import { generateApiKey, verifyApiKey } from "./apiKeys.js";

export interface ApiKeyActor {
  userId: ObjectId;
  role: UserRole;
}

export interface PublicApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
}

export class ApiKeyAccessError extends Error {
  constructor() {
    super("Not authorized to manage this API key");
    this.name = "ApiKeyAccessError";
  }
}

function toPublicApiKey(document: ApiKeyDocument): PublicApiKey {
  return {
    id: document._id.toHexString(),
    name: document.name,
    prefix: document.prefix,
    createdAt: document.createdAt,
    ...(document.lastUsedAt
      ? { lastUsedAt: document.lastUsedAt }
      : {}),
    ...(document.revokedAt ? { revokedAt: document.revokedAt } : {}),
  };
}

/**
 * The full key is returned only from this creation operation.
 * MongoDB stores the SHA-256 hash, never the presented key.
 */
export async function createUserApiKey(
  collection: Collection<ApiKeyDocument>,
  userId: ObjectId,
  name: string,
): Promise<{ apiKey: PublicApiKey; key: string }> {
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new Error("API key name is required");
  }

  const generated = generateApiKey();
  const document: ApiKeyDocument = {
    _id: new ObjectId(),
    userId,
    name: normalizedName,
    prefix: generated.prefix,
    hash: generated.hash,
    createdAt: new Date(),
  };

  await collection.insertOne(document);

  return {
    apiKey: toPublicApiKey(document),
    key: generated.key,
  };
}

/**
 * Members can list their own keys. Admins can list their own keys or
 * select a specific user's keys. The full hash is never returned.
 */
export async function listUserApiKeys(
  collection: Collection<ApiKeyDocument>,
  actor: ApiKeyActor,
  targetUserId?: ObjectId,
): Promise<PublicApiKey[]> {
  if (
    actor.role !== "admin" &&
    targetUserId &&
    !targetUserId.equals(actor.userId)
  ) {
    throw new ApiKeyAccessError();
  }

  const ownerId =
    actor.role === "admin" && targetUserId
      ? targetUserId
      : actor.userId;

  const documents = await collection
    .find({ userId: ownerId })
    .sort({ createdAt: -1 })
    .toArray();

  return documents.map(toPublicApiKey);
}

/**
 * Revocation is checked against MongoDB on every authentication attempt.
 * This function does not cache key validity.
 */
export async function revokeUserApiKey(
  collection: Collection<ApiKeyDocument>,
  keyId: ObjectId,
  actor: ApiKeyActor,
): Promise<boolean> {
  const filter =
    actor.role === "admin"
      ? { _id: keyId }
      : { _id: keyId, userId: actor.userId };

  const result = await collection.updateOne(filter, {
    $set: { revokedAt: new Date() },
  });

  // Use the same result for absent keys and keys owned by other members.
  return result.matchedCount > 0;
}

/**
 * Resolves the fixed-length prefix first, then verifies the full key.
 * Revoked keys return null immediately; the caller must also verify that
 * the associated user is active before authorizing the request.
 */
export async function findActiveApiKey(
  collection: Collection<ApiKeyDocument>,
  presentedKey: string,
): Promise<ApiKeyDocument | null> {
  const match =
    /^urumi_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/.exec(presentedKey);

  if (!match) {
    return null;
  }

  const document = await collection.findOne({ prefix: match[1] });

  if (!document || document.revokedAt) {
    return null;
  }

  return verifyApiKey(presentedKey, document.hash) ? document : null;
}
