import { lookup as systemLookup } from "node:dns/promises";
import type { TcpSocketConnectOpts } from "node:net";
import * as ipaddr from "ipaddr.js";
import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from "undici";

const INTERNAL_SERVICES = [
  { slug: "woo", name: "woo-mcp", port: "3001" },
  { slug: "time", name: "mcp-time", port: "3002" },
  { slug: "notes", name: "mcp-notes", port: "3003" },
] as const;

const BLOCKED_SUFFIXES = [
  ".localhost", ".local", ".localdomain", ".internal", ".lan",
  ".home", ".corp", ".test", ".invalid", ".example", ".svc",
  ".cluster.local", ".arpa", ".onion",
];

type DnsAddress = { address: string; family: number };
export type DnsResolver = (hostname: string) => Promise<DnsAddress[]>;
type SafeLookup = NonNullable<TcpSocketConnectOpts["lookup"]>;

function namespace(): string {
  return process.env.KUBERNETES_NAMESPACE ?? "urumi";
}

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

export function isTrustedInternalEndpoint(
  value: string,
  slug: string,
  currentNamespace = namespace(),
): boolean {
  const url = parseHttpUrl(value);
  if (
    !url ||
    url.protocol !== "http:" ||
    url.pathname !== "/mcp" ||
    url.search !== ""
  ) {
    return false;
  }

  return INTERNAL_SERVICES.some((service) => {
    if (service.slug !== slug || url.port !== service.port) return false;

    return hostnameOf(url) ===
      `${service.name}.${currentNamespace}.svc.cluster.local`;
  });
}

function isKnownInternalEndpoint(value: string): boolean {
  return INTERNAL_SERVICES.some((service) =>
    isTrustedInternalEndpoint(value, service.slug),
  );
}

function isPublicHostname(host: string): boolean {
  if (!host.includes(".") || host.endsWith(".")) return false;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  if (host === "localhost" || host === "metadata.google.internal") return false;

  const labels = host.split(".");
  return labels.every((label) =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

export function isPublicUnicastAddress(address: string): boolean {
  try {
    return ipaddr.isValid(address) &&
      ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export function isTrustedClusterAddress(address: string): boolean {
  try {
    if (!ipaddr.isValid(address)) return false;
    const range = ipaddr.process(address).range();
    return range === "private" || range === "uniqueLocal";
  } catch {
    return false;
  }
}

export function isAllowedServerUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;

  if (isKnownInternalEndpoint(value)) return true;

  // External egress is restricted by NetworkPolicy to TCP 443.
  if (url.protocol !== "https:" || url.port !== "") return false;

  const host = hostnameOf(url);
  if (ipaddr.isValid(host)) return isPublicUnicastAddress(host);

  return isPublicHostname(host);
}

export function assertAllowedServerDestination(
  value: string,
  slug: string,
): { url: URL; trustedInternal: boolean } {
  const url = parseHttpUrl(value);
  if (!url || !isAllowedServerUrl(value)) {
    throw new Error("Upstream destination is not permitted");
  }

  const trustedInternal = isTrustedInternalEndpoint(value, slug);
  const host = hostnameOf(url);

  if (
    (isKnownInternalEndpoint(value) && !trustedInternal) ||
    (!trustedInternal && ipaddr.isValid(host) && !isPublicUnicastAddress(host))
  ) {
    throw new Error("Upstream destination is not permitted");
  }

  return { url, trustedInternal };
}

function lookupError(): NodeJS.ErrnoException {
  const error = new Error("Upstream DNS result is not permitted") as NodeJS.ErrnoException;
  error.code = "EACCES";
  return error;
}

/**
 * DNS lookup hook for the actual TCP/TLS connection.
 * Rejects the entire answer set if any address violates policy, then returns
 * only validated addresses to the socket so it cannot perform a second lookup.
 */
export function createValidatedLookup(
  expectedHostname: string,
  trustedInternal: boolean,
  resolver: DnsResolver = (hostname) =>
    systemLookup(hostname, { all: true, verbatim: true }),
): SafeLookup {
  const expected = expectedHostname.toLowerCase().replace(/\.$/, "");

  return (hostname, options, callback) => {
    const actual = hostname.toLowerCase().replace(/\.$/, "");
    if (actual !== expected) {
      callback(lookupError(), "", 0);
      return;
    }

    void resolver(actual).then((answers) => {
      if (answers.length === 0) {
        callback(lookupError(), "", 0);
        return;
      }

      const allowed = answers.every(({ address }) =>
        trustedInternal
          ? isTrustedClusterAddress(address)
          : isPublicUnicastAddress(address),
      );

      if (!allowed) {
        callback(lookupError(), "", 0);
        return;
      }

      const family = options.family ?? 0;
      const selected = family === 0
        ? answers
        : answers.filter((answer) => answer.family === family);

      if (selected.length === 0) {
        callback(lookupError(), "", 0);
        return;
      }

      if (options.all) {
        callback(null, selected);
      } else {
        const first = selected[0];
        if (!first) {
          callback(lookupError(), "", 0);
          return;
        }
        callback(null, first.address, first.family);
      }
    }).catch(() => {
      callback(lookupError(), "", 0);
    });
  };
}

/**
 * Creates a per-upstream fetch function and dispatcher.
 * Only the configured endpoint may be requested; redirects always fail.
 */
export function createSafeUpstreamFetch(
  value: string,
  slug: string,
  resolver?: DnsResolver,
): { fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
     close: () => Promise<void> } {
  const { url, trustedInternal } = assertAllowedServerDestination(value, slug);
  const hostname = hostnameOf(url);
  const lookup = createValidatedLookup(hostname, trustedInternal, resolver);

  const agent = new Agent({
    connect: { lookup },
    maxRedirections: 0,
  });

  const safeFetch = async (
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const target = new URL(input instanceof URL ? input.href : input);

    if (target.href !== url.href) {
      throw new Error("Upstream request target changed");
    }

    const response = await undiciFetch(target, {
      ...init,
      dispatcher: agent,
      redirect: "error",
    } as UndiciRequestInit);

    return response as unknown as Response;
  };

  return {
    fetch: safeFetch,
    close: async () => {
      await agent.close();
    },
  };
}
