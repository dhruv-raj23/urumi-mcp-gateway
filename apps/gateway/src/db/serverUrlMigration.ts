import type { Collection } from "mongodb";

import {
  assertAllowedServerDestination,
  canonicalInternalServerUrl,
} from "../security/ssrf.js";
import type { ServerDocument } from "./models.js";

const LEGACY_BUILTIN_URLS = [
  { slug: "woo", url: "http://woo-mcp:3001/mcp" },
  { slug: "time", url: "http://mcp-time:3002/mcp" },
  { slug: "notes", url: "http://mcp-notes:3003/mcp" },
] as const;

/**
 * Migrates only the exact legacy short URLs used by built-in MCP servers.
 *
 * Custom URLs and authentication fields are preserved. The URL match in
 * updateOne prevents overwriting a concurrent administrator configuration
 * change. Enabled servers are marked pending so the normal health loop
 * must verify connectivity before tools become available.
 */
export async function migrateLegacyBuiltinServerUrls(
  servers: Collection<ServerDocument>,
): Promise<number> {
  let migratedCount = 0;

  for (const legacy of LEGACY_BUILTIN_URLS) {
    const canonicalUrl = canonicalInternalServerUrl(legacy.slug);

    if (!canonicalUrl) {
      throw new Error("Canonical built-in server URL is unavailable");
    }

    try {
      assertAllowedServerDestination(canonicalUrl, legacy.slug);
    } catch {
      throw new Error("Canonical built-in server URL is not permitted");
    }

    const existing = await servers.findOne({
      slug: legacy.slug,
      url: legacy.url,
    });

    if (!existing) continue;

    const setValues: Partial<ServerDocument> = {
      url: canonicalUrl,
    };

    if (existing.enabled) {
      setValues.status = "unreachable";
      setValues.statusReason = "configuration changed; health check pending";
    }

    const result = await servers.updateOne(
      {
        _id: existing._id,
        slug: legacy.slug,
        url: legacy.url,
      },
      { $set: setValues },
    );

    if (result.modifiedCount === 1) {
      migratedCount += 1;
    }
  }

  return migratedCount;
}
