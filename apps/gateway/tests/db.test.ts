import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

import {
  connectGatewayDatabase,
  ensureGatewayIndexes,
  getGatewayCollections,
  GATEWAY_COLLECTION_NAMES,
} from "../src/db/mongo.js";

describe("gateway MongoDB foundation", () => {
  it("uses only the four contract-defined collections", () => {
    const collection = vi.fn((name: string) => ({ name }));
    const db = { collection } as unknown as Db;

    const collections = getGatewayCollections(db);

    expect(Object.keys(collections)).toEqual([
      "users",
      "apikeys",
      "servers",
      "auditlogs",
    ]);

    expect(collection).toHaveBeenCalledTimes(4);
    expect(GATEWAY_COLLECTION_NAMES).toHaveLength(4);
  });

  it("creates unique indexes for email, API-key prefix, and server slug", async () => {
    const calls: Array<{
      collection: string;
      keys: Record<string, number>;
      options?: { unique?: boolean; sparse?: boolean; name?: string };
    }> = [];

    const db = {
      collection: (collectionName: string) => ({
        createIndex: async (
          keys: Record<string, number>,
          options?: { unique?: boolean; sparse?: boolean; name?: string },
        ) => {
          calls.push({ collection: collectionName, keys, options });
          return options?.name ?? "test-index";
        },
      }),
    } as unknown as Db;

    await ensureGatewayIndexes(db);

    expect(calls).toHaveLength(10);

    expect(
      calls.some(
        (call) =>
          call.collection === "users" &&
          call.options?.unique === true &&
          call.options.name === "users_email_unique",
      ),
    ).toBe(true);

    expect(
      calls.some(
        (call) =>
          call.collection === "users" &&
          call.keys.inviteTokenHash === 1 &&
          call.options?.sparse === true &&
          call.options.name === "users_inviteTokenHash_sparse",
      ),
    ).toBe(true);

    expect(
      calls.some(
        (call) =>
          call.collection === "apikeys" &&
          call.options?.unique === true &&
          call.options.name === "apikeys_prefix_unique",
      ),
    ).toBe(true);

    expect(
      calls.some(
        (call) =>
          call.collection === "servers" &&
          call.options?.unique === true &&
          call.options.name === "servers_slug_unique",
      ),
    ).toBe(true);

    expect(
      calls.some(
        (call) =>
          call.collection === "auditlogs" &&
          call.keys.ts === -1 &&
          call.keys._id === -1 &&
          call.options?.name === "auditlogs_ts_id_desc",
      ),
    ).toBe(true);
  });

  it("rejects a missing MongoDB URI without connecting", async () => {
    await expect(connectGatewayDatabase("")).rejects.toThrow(
      "MONGO_URI is required",
    );
  });
});
