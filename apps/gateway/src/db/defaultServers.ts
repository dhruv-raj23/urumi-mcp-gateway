import { ObjectId, type Collection } from "mongodb";

import { encryptCredential } from "../crypto/credentials.js";
import type { ServerDocument } from "./models.js";

export interface DefaultWooServerOptions {
  url?: string;
  token?: string;
  encryptionKey?: string;
}

export type DefaultWooServerResult = "created" | "already-registered";

/**
 * Register WooCommerce once during gateway startup.
 *
 * $setOnInsert preserves all existing administrator-managed settings.
 * The unique server slug index prevents duplicate registrations.
 */
export async function ensureDefaultWooServer(
  servers: Collection<ServerDocument>,
  options: DefaultWooServerOptions = {},
): Promise<DefaultWooServerResult> {
  const existing = await servers.findOne({ slug: "woo" });
  if (existing) {
    return "already-registered";
  }

  const url = (options.url ?? process.env.WOO_MCP_URL)?.trim();
  const token = options.token ?? process.env.WOO_MCP_AUTH_TOKEN;
  const encryptionKey =
    options.encryptionKey ?? process.env.CREDENTIAL_ENCRYPTION_KEY;

  if (!url) {
    throw new Error("WOO_MCP_URL is required");
  }

  if (!token) {
    throw new Error("WOO_MCP_AUTH_TOKEN is required");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("WOO_MCP_URL must be a valid HTTP(S) URL");
  }

  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== ""
  ) {
    throw new Error("WOO_MCP_URL must be HTTP(S) without embedded credentials");
  }

  const document: ServerDocument = {
    _id: new ObjectId(),
    slug: "woo",
    name: "WooCommerce MCP",
    url,
    authType: "bearer",
    credentialEnc: encryptCredential(token, encryptionKey),
    enabled: true,
    status: "unreachable",
    statusReason: "not checked yet",
    createdAt: new Date(),
  };

  try {
    const result = await servers.updateOne(
      { slug: "woo" },
      { $setOnInsert: document },
      { upsert: true },
    );

    return result.upsertedCount === 1 ? "created" : "already-registered";
  } catch (error) {
    // Concurrent gateway starts can race on the unique slug index.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === 11000
    ) {
      const existing = await servers.findOne({ slug: "woo" });

      if (existing) {
        return "already-registered";
      }
    }

    throw error;
  }
}
