import {
  MongoClient,
  type Collection,
  type CreateIndexesOptions,
  type Db,
  type IndexSpecification,
} from "mongodb";

import type {
  ApiKeyDocument,
  AuditLogDocument,
  ServerDocument,
  UserDocument,
} from "./models.js";

export const MONGO_DATABASE_NAME = "urumi" as const;

export const GATEWAY_COLLECTION_NAMES = [
  "users",
  "apikeys",
  "servers",
  "auditlogs",
] as const;

export type GatewayCollectionName =
  (typeof GATEWAY_COLLECTION_NAMES)[number];

export interface GatewayCollections {
  users: Collection<UserDocument>;
  apikeys: Collection<ApiKeyDocument>;
  servers: Collection<ServerDocument>;
  auditlogs: Collection<AuditLogDocument>;
}

export interface GatewayDatabase {
  client: MongoClient;
  db: Db;
  collections: GatewayCollections;
}

interface IndexDefinition {
  keys: IndexSpecification;
  options?: CreateIndexesOptions;
}

/**
 * Indexes support contract-required uniqueness and common ownership/audit
 * queries. No database fields or API routes are created by this module.
 */
const INDEX_DEFINITIONS: Record<
  GatewayCollectionName,
  readonly IndexDefinition[]
> = {
  users: [
    {
      keys: { email: 1 },
      options: { unique: true, name: "users_email_unique" },
    },
    {
      keys: { inviteTokenHash: 1 },
      options: { sparse: true, name: "users_inviteTokenHash_sparse" },
    },
  ],
  apikeys: [
    {
      keys: { prefix: 1 },
      options: { unique: true, name: "apikeys_prefix_unique" },
    },
    {
      keys: { userId: 1, createdAt: -1 },
      options: { name: "apikeys_user_created" },
    },
  ],
  servers: [
    {
      keys: { slug: 1 },
      options: { unique: true, name: "servers_slug_unique" },
    },
  ],
  auditlogs: [
    {
      keys: { userId: 1, ts: -1 },
      options: { name: "auditlogs_user_ts" },
    },
    {
      keys: { ts: -1 },
      options: { name: "auditlogs_ts" },
    },
    {
      keys: { ts: -1, _id: -1 },
      options: { name: "auditlogs_ts_id_desc" },
    },
    {
      keys: { serverSlug: 1, ts: -1 },
      options: { name: "auditlogs_server_ts" },
    },
    {
      keys: { outcome: 1, ts: -1 },
      options: { name: "auditlogs_outcome_ts" },
    },
  ],
};

/** Returns typed handles for exactly the four collections in contract §9. */
export function getGatewayCollections(db: Db): GatewayCollections {
  return {
    users: db.collection<UserDocument>("users"),
    apikeys: db.collection<ApiKeyDocument>("apikeys"),
    servers: db.collection<ServerDocument>("servers"),
    auditlogs: db.collection<AuditLogDocument>("auditlogs"),
  };
}

/** Ensure required indexes exist before the gateway starts handling requests. */
export async function ensureGatewayIndexes(db: Db): Promise<void> {
  for (const collectionName of GATEWAY_COLLECTION_NAMES) {
    const collection = db.collection(collectionName);

    for (const index of INDEX_DEFINITIONS[collectionName]) {
      await collection.createIndex(index.keys, index.options);
    }
  }
}

/**
 * Opens the contract-defined database. The URI is never included in errors
 * or logs because it may contain credentials.
 */
export async function connectGatewayDatabase(
  uri: string | undefined = process.env.MONGO_URI,
): Promise<GatewayDatabase> {
  if (!uri?.trim()) {
    throw new Error("MONGO_URI is required");
  }

  let client: MongoClient | undefined;

  try {
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10_000,
    });

    await client.connect();

    const db = client.db(MONGO_DATABASE_NAME);
    await ensureGatewayIndexes(db);

    return {
      client,
      db,
      collections: getGatewayCollections(db),
    };
  } catch {
    if (client) {
      await client.close().catch(() => undefined);
    }

    throw new Error("MongoDB connection or index initialization failed");
  }
}
