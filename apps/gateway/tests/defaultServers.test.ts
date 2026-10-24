import { ObjectId, type Collection } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import {
  decryptCredential,
} from "../src/crypto/credentials.js";
import {
  ensureDefaultWooServer,
} from "../src/db/defaultServers.js";
import type { ServerDocument } from "../src/db/models.js";

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const TEST_TOKEN = "test-only-upstream-token";
const TEST_URL = "http://woo-mcp.urumi.svc.cluster.local:3001/mcp";

function makeExistingServer(): ServerDocument {
  return {
    _id: new ObjectId(),
    slug: "woo",
    name: "Admin-customized WooCommerce",
    url: "http://custom-woo.internal:3001/mcp",
    authType: "none",
    enabled: false,
    status: "disabled",
    statusReason: "Disabled by administrator",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function fakeServers(initial: ServerDocument | null = null) {
  let stored = initial;

  const findOne = vi.fn(async (_filter: { slug: string }) => stored);

  const updateOne = vi.fn(async (
    _filter: { slug: string },
    update: { $setOnInsert: ServerDocument },
    _options: { upsert: boolean },
  ) => {
    if (!stored) {
      stored = update.$setOnInsert;
      return {
        upsertedCount: 1,
        upsertedId: stored._id,
      };
    }

    return { upsertedCount: 0 };
  });

  return {
    collection: {
      findOne,
      updateOne,
    } as unknown as Collection<ServerDocument>,
    findOne,
    updateOne,
    getStored: () => stored,
  };
}

describe("default WooCommerce MCP registration", () => {
  it("registers WooCommerce on a fresh database with an encrypted token", async () => {
    const {
      collection,
      findOne,
      updateOne,
      getStored,
    } = fakeServers();

    const result = await ensureDefaultWooServer(collection, {
      url: TEST_URL,
      token: TEST_TOKEN,
      encryptionKey: ENCRYPTION_KEY,
    });

    expect(result).toBe("created");
    expect(findOne).toHaveBeenCalledWith({ slug: "woo" });
    expect(updateOne).toHaveBeenCalledWith(
      { slug: "woo" },
      {
        $setOnInsert: expect.objectContaining({
          slug: "woo",
          name: "WooCommerce MCP",
          url: TEST_URL,
          authType: "bearer",
          enabled: true,
          status: "unreachable",
          statusReason: "not checked yet",
        }),
      },
      { upsert: true },
    );

    const stored = getStored();
    expect(stored).not.toBeNull();
    expect(stored?.credentialEnc).toBeTruthy();
    expect(stored?.credentialEnc).not.toBe(TEST_TOKEN);
    expect(
      decryptCredential(stored!.credentialEnc!, ENCRYPTION_KEY),
    ).toBe(TEST_TOKEN);
  });

  it("preserves an existing server without requiring bootstrap secrets", async () => {
    const existing = makeExistingServer();
    const { collection, updateOne, getStored } = fakeServers(existing);

    const result = await ensureDefaultWooServer(collection);

    expect(result).toBe("already-registered");
    expect(updateOne).not.toHaveBeenCalled();
    expect(getStored()).toBe(existing);
    expect(getStored()?.name).toBe("Admin-customized WooCommerce");
    expect(getStored()?.enabled).toBe(false);
    expect(getStored()?.authType).toBe("none");
  });

  it("rejects a missing URL before inserting anything", async () => {
    const { collection, updateOne } = fakeServers();

    await expect(
      ensureDefaultWooServer(collection, {
        url: " ",
        token: TEST_TOKEN,
        encryptionKey: ENCRYPTION_KEY,
      }),
    ).rejects.toThrow("WOO_MCP_URL is required");

    expect(updateOne).not.toHaveBeenCalled();
  });

  it("rejects a missing token before inserting anything", async () => {
    const { collection, updateOne } = fakeServers();

    await expect(
      ensureDefaultWooServer(collection, {
        url: TEST_URL,
        token: "",
        encryptionKey: ENCRYPTION_KEY,
      }),
    ).rejects.toThrow("WOO_MCP_AUTH_TOKEN is required");

    expect(updateOne).not.toHaveBeenCalled();
  });

  it("rejects non-HTTP URLs and URLs containing embedded credentials", async () => {
    const { collection, updateOne } = fakeServers();

    await expect(
      ensureDefaultWooServer(collection, {
        url: "ftp://woo-mcp.internal/mcp",
        token: TEST_TOKEN,
        encryptionKey: ENCRYPTION_KEY,
      }),
    ).rejects.toThrow("WOO_MCP_URL must be HTTP(S) without embedded credentials");

    await expect(
      ensureDefaultWooServer(collection, {
        url: "https://user:password@woo-mcp.internal/mcp",
        token: TEST_TOKEN,
        encryptionKey: ENCRYPTION_KEY,
      }),
    ).rejects.toThrow("WOO_MCP_URL must be HTTP(S) without embedded credentials");

    expect(updateOne).not.toHaveBeenCalled();
  });

  it("handles a concurrent registration detected by the unique slug index", async () => {
    const existing = makeExistingServer();

    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);

    const updateOne = vi.fn().mockRejectedValue({ code: 11000 });

    const collection = {
      findOne,
      updateOne,
    } as unknown as Collection<ServerDocument>;

    const result = await ensureDefaultWooServer(collection, {
      url: TEST_URL,
      token: TEST_TOKEN,
      encryptionKey: ENCRYPTION_KEY,
    });

    expect(result).toBe("already-registered");
    expect(findOne).toHaveBeenCalledTimes(2);
  });
});
