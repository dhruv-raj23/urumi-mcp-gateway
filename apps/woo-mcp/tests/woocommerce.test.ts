import { describe, expect, it } from "vitest";

import {
  WooCommerceClient,
  WooCommerceRequestError,
} from "../src/woocommerce.js";

const config = {
  baseUrl: "http://woo.example.test",
  consumerKey: "dummy-consumer-key",
  consumerSecret: "dummy-consumer-secret-SENTINEL",
};

describe("WooCommerceClient failure handling", () => {
  it("does not expose WooCommerce error response bodies", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          message: "leaked-secret-SENTINEL",
          consumer_secret: config.consumerSecret,
        }),
        { status: 401 },
      );

    const client = new WooCommerceClient(config, fetchImpl);

    let caught: unknown;
    try {
      await client.listProducts({});
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WooCommerceRequestError);
    expect((caught as Error).message).toBe(
      "WooCommerce API returned HTTP 401",
    );
    expect((caught as Error).message).not.toContain("SENTINEL");
  });

  it("returns a safe timeout error without exposing low-level details", async () => {
    const fetchImpl: typeof fetch = async () => {
      const error = new Error(
        `timeout talking to woo.example.test with ${config.consumerSecret}`,
      );
      error.name = "TimeoutError";
      throw error;
    };

    const client = new WooCommerceClient(config, fetchImpl);

    await expect(client.listProducts({})).rejects.toThrow(
      "WooCommerce API request timed out",
    );
    await expect(client.listProducts({})).rejects.not.toThrow("SENTINEL");
  });

  it("rejects responses over 100 KB", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("x".repeat(100_001), { status: 200 });

    const client = new WooCommerceClient(config, fetchImpl);

    await expect(client.listProducts({})).rejects.toThrow(
      "WooCommerce API response exceeded the 100 KB limit",
    );
  });

  it("rejects invalid JSON from the upstream API", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("{not valid JSON", { status: 200 });

    const client = new WooCommerceClient(config, fetchImpl);

    await expect(client.listProducts({})).rejects.toThrow(
      "WooCommerce API returned invalid JSON",
    );
  });
});
