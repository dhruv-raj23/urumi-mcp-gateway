import { describe, expect, it } from "vitest";

import {
  assertAllowedServerDestination,
  createValidatedLookup,
  createSafeUpstreamFetch,
  isAllowedServerUrl,
  isPublicUnicastAddress,
  isTrustedClusterAddress,
  isTrustedInternalEndpoint,
} from "../src/security/ssrf.js";

describe("SSRF URL policy", () => {
  it.each([
    "http://127.0.0.1/mcp",
    "http://10.0.0.8/mcp",
    "http://172.16.0.1/mcp",
    "http://192.168.1.10/mcp",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/mcp",
    "http://localhost/mcp",
    "http://metadata.google.internal/mcp",
    "http://admin.svc.cluster.local/mcp",
    "http://host.internal/mcp",
  ])("rejects unsafe destination %s", (url) => {
    expect(isAllowedServerUrl(url)).toBe(false);
  });

  it.each([
    "https://example.com/mcp",
    "https://8.8.8.8/mcp",
  ])("allows public-looking destination syntax %s", (url) => {
    expect(isAllowedServerUrl(url)).toBe(true);
  });

  it("permits only the matching built-in in-cluster endpoint", () => {
    const url = "http://woo-mcp.urumi.svc.cluster.local:3001/mcp";

    expect(isTrustedInternalEndpoint(url, "woo")).toBe(true);
    expect(isTrustedInternalEndpoint(url, "time")).toBe(false);
    expect(assertAllowedServerDestination(url, "woo").trustedInternal).toBe(true);
    expect(() => assertAllowedServerDestination(url, "custom")).toThrow(
      "Upstream destination is not permitted",
    );
  });

  it("rejects non-public IP ranges and recognizes private cluster addresses", () => {
    expect(isPublicUnicastAddress("8.8.8.8")).toBe(true);
    expect(isPublicUnicastAddress("127.0.0.1")).toBe(false);
    expect(isPublicUnicastAddress("169.254.169.254")).toBe(false);
    expect(isTrustedClusterAddress("10.43.0.15")).toBe(true);
    expect(isTrustedClusterAddress("127.0.0.1")).toBe(false);
  });

  it("rejects DNS answers if even one answer is private", async () => {
    const lookup = createValidatedLookup(
      "public.example.com",
      false,
      async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.8", family: 4 },
      ],
    );

    await expect(new Promise((resolve, reject) => {
      lookup(
        "public.example.com",
        { all: true, verbatim: true },
        (error, addresses) => error ? reject(error) : resolve(addresses),
      );
    })).rejects.toMatchObject({ code: "EACCES" });
  });

  it("returns validated public DNS answers to the socket callback", async () => {
    const lookup = createValidatedLookup(
      "public.example.com",
      false,
      async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "8.8.8.8", family: 4 },
      ],
    );

    const addresses = await new Promise<unknown>((resolve, reject) => {
      lookup(
        "public.example.com",
        { all: true, verbatim: true },
        (error, result) => error ? reject(error) : resolve(result),
      );
    });

    expect(addresses).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "8.8.8.8", family: 4 },
    ]);
  });

  it("rejects a socket lookup for a different hostname", async () => {
    const resolver = async () => {
      throw new Error("Resolver should not run for a mismatched hostname");
    };
    const lookup = createValidatedLookup(
      "public.example.com",
      false,
      resolver,
    );

    await expect(new Promise((resolve, reject) => {
      lookup(
        "169.254.169.254",
        { all: true, verbatim: true },
        (error, addresses) => error ? reject(error) : resolve(addresses),
      );
    })).rejects.toMatchObject({ code: "EACCES" });
  });


  it("rejects a changed request destination before making a network request", async () => {
    const upstream = createSafeUpstreamFetch(
      "https://example.com/mcp",
      "custom",
      async () => [{ address: "93.184.216.34", family: 4 }],
    );

    try {
      await expect(
        upstream.fetch("https://example.com/other"),
      ).rejects.toThrow("Upstream request target changed");

      await expect(
        upstream.fetch("https://attacker.example/mcp"),
      ).rejects.toThrow("Upstream request target changed");
    } finally {
      await upstream.close();
    }
  });

});
