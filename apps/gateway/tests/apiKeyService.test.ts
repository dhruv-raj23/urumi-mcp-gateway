import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Collection } from "mongodb";

import type { ApiKeyDocument } from "../src/db/models.js";
import {
  ApiKeyAccessError,
  createUserApiKey,
  findActiveApiKey,
  listUserApiKeys,
  revokeUserApiKey,
} from "../src/auth/apiKeyService.js";

function fakeCollection() {
  const documents: ApiKeyDocument[] = [];

  const collection = {
    insertOne: vi.fn(async (document: ApiKeyDocument) => {
      documents.push(document);
      return { acknowledged: true, insertedId: document._id };
    }),

    find: vi.fn((filter: { userId: ObjectId }) => ({
      sort: () => ({
        toArray: async () =>
          documents
            .filter((document) => document.userId.equals(filter.userId))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      }),
    })),

    findOne: vi.fn(async (filter: { prefix: string }) =>
      documents.find((document) => document.prefix === filter.prefix) ?? null,
    ),

    updateOne: vi.fn(async (
      filter: { _id: ObjectId; userId?: ObjectId },
      update: { $set: { revokedAt: Date } },
    ) => {
      const document = documents.find(
        (item) =>
          item._id.equals(filter._id) &&
          (!filter.userId || item.userId.equals(filter.userId)),
      );

      if (!document) {
        return { matchedCount: 0, modifiedCount: 0 };
      }

      document.revokedAt = update.$set.revokedAt;
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };

  return {
    collection: collection as unknown as Collection<ApiKeyDocument>,
    documents,
    methods: collection,
  };
}

describe("API-key service", () => {
  it("stores only the key hash and returns the full key at creation", async () => {
    const { collection, documents } = fakeCollection();
    const userId = new ObjectId();

    const result = await createUserApiKey(
      collection,
      userId,
      "  My integration  ",
    );

    expect(result.key).toMatch(/^urumi_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(result.apiKey.name).toBe("My integration");
    expect(result.apiKey).not.toHaveProperty("userId");
    expect(documents).toHaveLength(1);
    expect(documents[0]?.hash).not.toBe(result.key);
    expect(documents[0]).not.toHaveProperty("key");
    expect(result.apiKey).not.toHaveProperty("hash");
    expect(result.apiKey).not.toHaveProperty("credentialEnc");
  });

  it("lists only the owner's keys and omits hashes", async () => {
    const { collection } = fakeCollection();
    const owner = new ObjectId();
    const other = new ObjectId();

    await createUserApiKey(collection, owner, "Owner key");
    await createUserApiKey(collection, other, "Other key");

    const listed = await listUserApiKeys(collection, {
      userId: owner,
      role: "member",
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("Owner key");
    expect(listed[0]).not.toHaveProperty("hash");

    await expect(
      listUserApiKeys(collection, {
        userId: owner,
        role: "member",
      }, other),
    ).rejects.toBeInstanceOf(ApiKeyAccessError);
  });

  it("allows admins to list a specific user's keys", async () => {
    const { collection } = fakeCollection();
    const admin = new ObjectId();
    const member = new ObjectId();

    await createUserApiKey(collection, member, "Member key");

    const listed = await listUserApiKeys(
      collection,
      { userId: admin, role: "admin" },
      member,
    );

    expect(listed).toHaveLength(1);

    expect(listed[0]).not.toHaveProperty("userId");
    expect(listed[0]).not.toHaveProperty("hash");
  });

  it("rejects a key immediately after it is revoked", async () => {
    const { collection, documents } = fakeCollection();
    const owner = new ObjectId();

    const created = await createUserApiKey(collection, owner, "Revocable");
    const stored = documents[0]!;

    await expect(
      findActiveApiKey(collection, created.key),
    ).resolves.toMatchObject({ _id: stored._id });

    await expect(
      revokeUserApiKey(collection, stored._id, {
        userId: owner,
        role: "member",
      }),
    ).resolves.toBe(true);

    await expect(
      findActiveApiKey(collection, created.key),
    ).resolves.toBeNull();
  });

  it("does not allow a member to revoke another user's key", async () => {
    const { collection } = fakeCollection();
    const owner = new ObjectId();
    const other = new ObjectId();

    const created = await createUserApiKey(collection, owner, "Protected");

    await expect(
      revokeUserApiKey(
        collection,
        new ObjectId(created.apiKey.id),
        { userId: other, role: "member" },
      ),
    ).resolves.toBe(false);

    await expect(
      findActiveApiKey(collection, created.key),
    ).resolves.not.toBeNull();
  });

  it("rejects malformed and incorrect API keys", async () => {
    const { collection, methods } = fakeCollection();

    await expect(
      findActiveApiKey(collection, "not-a-key"),
    ).resolves.toBeNull();

    expect(methods.findOne).not.toHaveBeenCalled();
  });
});
