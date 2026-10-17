export const ORDER_STATUSES = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
] as const;

export type WooOrderStatus = (typeof ORDER_STATUSES)[number];

export interface WooCommerceConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface ProductListInput {
  search?: string;
  per_page?: number;
}

export interface CreateProductInput {
  name: string;
  price: number;
  description?: string;
}

export interface OrderListInput {
  after?: string;
  before?: string;
  status?: WooOrderStatus;
  per_page?: number;
}

type RequestMethod = "GET" | "POST" | "PUT";

interface RequestOptions {
  method: RequestMethod;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 100_000;

export class WooCommerceRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WooCommerceRequestError";
  }
}

export class WooCommerceClient {
  private readonly apiBaseUrl: URL;
  private readonly authorization: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    config: WooCommerceConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    let baseUrl: URL;

    try {
      baseUrl = new URL(config.baseUrl);
    } catch {
      throw new WooCommerceRequestError(
        "WC_BASE_URL must be a valid URL",
      );
    }

    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw new WooCommerceRequestError(
        "WC_BASE_URL must use HTTP or HTTPS",
      );
    }

    if (!config.consumerKey || !config.consumerSecret) {
      throw new WooCommerceRequestError(
        "WooCommerce API credentials are not configured",
      );
    }

    baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "");
    this.apiBaseUrl = new URL(
      `${baseUrl.toString().replace(/\/+$/, "")}/wp-json/wc/v3/`,
    );

    this.authorization =
      "Basic " +
      Buffer.from(
        `${config.consumerKey}:${config.consumerSecret}`,
        "utf8",
      ).toString("base64");

    this.fetchImpl = fetchImpl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions,
  ): Promise<T> {
    const url = new URL(endpoint, this.apiBaseUrl);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        method: options.method,
        headers: {
          Accept: "application/json",
          Authorization: this.authorization,
          "X-Forwarded-Proto": "https",
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new WooCommerceRequestError(
          "WooCommerce API request timed out",
        );
      }

      // Do not expose low-level fetch errors or request details to MCP clients.
      throw new WooCommerceRequestError(
        "WooCommerce API could not be reached",
      );
    }

    let responseText: string;

    try {
      responseText = await response.text();
    } catch {
      throw new WooCommerceRequestError(
        "Could not read the WooCommerce API response",
      );
    }

    if (Buffer.byteLength(responseText, "utf8") > MAX_RESPONSE_BYTES) {
      throw new WooCommerceRequestError(
        "WooCommerce API response exceeded the 100 KB limit",
      );
    }

    if (!response.ok) {
      // Do not return the upstream response body; it is not safe to expose.
      throw new WooCommerceRequestError(
        `WooCommerce API returned HTTP ${response.status}`,
      );
    }

    if (!responseText) {
      return null as T;
    }

    try {
      const parsed: unknown = JSON.parse(responseText);
      return parsed as T;
    } catch {
      throw new WooCommerceRequestError(
        "WooCommerce API returned invalid JSON",
      );
    }
  }

  listProducts(input: ProductListInput): Promise<unknown> {
    return this.request("products", {
      method: "GET",
      query: {
        search: input.search,
        per_page: input.per_page ?? 10,
      },
    });
  }

  createProduct(input: CreateProductInput): Promise<unknown> {
    return this.request("products", {
      method: "POST",
      body: {
        name: input.name,
        type: "simple",
        status: "publish",
        regular_price: String(input.price),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
      },
    });
  }

  listOrders(input: OrderListInput): Promise<unknown> {
    return this.request("orders", {
      method: "GET",
      query: {
        after: input.after,
        before: input.before,
        status: input.status,
        per_page: input.per_page ?? 10,
      },
    });
  }

  getOrder(id: number): Promise<unknown> {
    return this.request(`orders/${id}`, { method: "GET" });
  }

  updateOrderStatus(
    id: number,
    status: WooOrderStatus,
  ): Promise<unknown> {
    return this.request(`orders/${id}`, {
      method: "PUT",
      body: { status },
    });
  }
}
