import { ObjectId, type Collection } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerDocument } from "../src/db/models.js";
import {
  migrateLegacyBuiltinServerUrls,
} from "../src/db/serverUrlMigration.js";
import {
  canonicalInternalServerUrl,
} from "../src/security/ssrf.js";

const LEGACY_URLS = [
  { slug: "woo", url: "http://woo-mcp:3001/mcp" },
  { slug: "time", url: "http://mcp-time:3002/mcp" },
  { slug: "notes", url: "http://mcp-notes:3003/mcp" },
] as const;

function makeServer(
  slug: string,
  url: string,
  enabled = true,
): ServerDocument {
  return {
    _id: new ObjectId(),
    slug,
    name: `${slug}-server`,
    url,
    authType: slug === "woo" ? "bearer" : "none",
    ...(slug === "woo"
      ? { credentialEnc: "encrypted-woo-credential" }
      : {}),
    enabled,
    status: enabled ? "unreachable" : "disabled",
    statusReason: enabled
      ? "Upstream health check failed"
      : "Disabled by administrator",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function fakeServers(initial: ServerDocument[]) {
  const stored = initial.map((server) => ({ ...server }));

  const findOne = vi.fn(async (filter: { slug: string; url: string }) =>
    stored.find(
      (server) =>
        server.slug === filter.slug && server.url === filter.url,
    ) ?? null,
  );

  const updateOne = vi.fn(async (
    filter: { _id: ObjectId; slug: string; url: string },
    update: { $set: Partial<ServerDocument> },
  ) => {
    const server = stored.find(
      (candidate) =>
        candidate._id.equals(filter._id) &&
        candidate.slug === filter.slug &&
        candidate.url === filter.url,
    );

    if (!server) return { matchedCount: 0, modifiedCount: 0 };

    Object.assign(server, update.$set);
    return { matchedCount: 1, modifiedCount: 1 };
  });

  return {
    collection: { findOne, updateOne } as unknown as Collection<ServerDocument>,
    updateOne,
    stored,
  };
}

describe("legacy built-in server URL migration", () => {
  beforeEach(() => {
    vi.stubEnv("KUBERNETES_NAMESPACE", "urumi");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("migrates the three exact legacy built-in URLs", async () => {
    const { collection, stored } = fakeServers(
      LEGACY_URLS.map(({ slug, url }) => makeServer(slug, url)),
    );
    const woo = stored.find((server) => server.slug === "woo")!;
    const originalCredential = woo.credentialEnc;
    const originalAuthType = woo.authType;

    expect(await migrateLegacyBuiltinServerUrls(collection)).toBe(3);

    for (const server of stored) {
      expect(server.url).toBe(canonicalInternalServerUrl(server.slug));
      expect(server.status).toBe("unreachable");
      expect(server.statusReason).toBe(
        "configuration changed; health check pending",
      );
    }

    expect(woo.credentialEnc).toBe(originalCredential);
    expect(woo.authType).toBe(originalAuthType);
  });

  it("is idempotent", async () => {
    const { collection } = fakeServers(
      LEGACY_URLS.map(({ slug, url }) => makeServer(slug, url)),
    );

    expect(await migrateLegacyBuiltinServerUrls(collection)).toBe(3);
    expect(await migrateLegacyBuiltinServerUrls(collection)).toBe(0);
  });

  it("leaves custom administrator URLs untouched", async () => {
    const custom = makeServer("woo", "https://woo.example.com/mcp");
    const { collection, stored, updateOne } = fakeServers([custom]);

    expect(await migrateLegacyBuiltinServerUrls(collection)).toBe(0);
    expect(stored[0]?.url).toBe("https://woo.example.com/mcp");
    expect(stored[0]?.statusReason).toBe("Upstream health check failed");
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("does not enable a disabled legacy server", async () => {
    const disabled = makeServer(
      "notes",
      "http://mcp-notes:3003/mcp",
      false,
    );
    const { collection, stored } = fakeServers([disabled]);

    expect(await migrateLegacyBuiltinServerUrls(collection)).toBe(1);
    expect(stored[0]?.url).toBe(canonicalInternalServerUrl("notes"));
    expect(stored[0]?.enabled).toBe(false);
    expect(stored[0]?.status).toBe("disabled");
    expect(stored[0]?.statusReason).toBe("Disabled by administrator");
  });
});
