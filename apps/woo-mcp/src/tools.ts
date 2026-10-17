import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  ORDER_STATUSES,
  WooCommerceRequestError,
  type WooCommerceClient,
} from "./woocommerce.js";

const orderStatusSchema = z.enum(ORDER_STATUSES);

const dateSchema = z.string().refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
  "Expected an ISO date or ISO date-time",
);

function toolHandler<TArgs>(
  action: (args: TArgs) => Promise<unknown>,
): (args: TArgs) => Promise<CallToolResult> {
  return async (args: TArgs): Promise<CallToolResult> => {
    try {
      const result = await action(args);
      const text = JSON.stringify(result);

      if (Buffer.byteLength(text, "utf8") > 100_000) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "WooCommerce tool result exceeded the 100 KB limit",
            },
          ],
        };
      }

      return {
        content: [{ type: "text", text }],
      };
    } catch (error: unknown) {
      const message =
        error instanceof WooCommerceRequestError
          ? error.message
          : "WooCommerce tool call failed";

      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  };
}

export function registerWooCommerceTools(
  server: McpServer,
  client: WooCommerceClient,
): void {
  server.registerTool(
    "list_products",
    {
      description:
        "List WooCommerce products, optionally filtered by search text.",
      inputSchema: z
        .object({
          search: z.string().trim().min(1).max(200).optional(),
          per_page: z.number().int().min(1).max(50).default(10),
        })
        .strict(),
    },
    toolHandler((args) => client.listProducts(args)),
  );

  server.registerTool(
    "create_product",
    {
      description:
        "Create and publish a simple WooCommerce product at the given price.",
      inputSchema: z
        .object({
          name: z.string().trim().min(1).max(200),
          price: z.number().finite().positive(),
          description: z.string().max(5_000).optional(),
        })
        .strict(),
    },
    toolHandler((args) => client.createProduct(args)),
  );

  server.registerTool(
    "list_orders",
    {
      description:
        "List WooCommerce orders, optionally filtered by date, status, and page size.",
      inputSchema: z
        .object({
          after: dateSchema.optional(),
          before: dateSchema.optional(),
          status: orderStatusSchema.optional(),
          per_page: z.number().int().min(1).max(50).default(10),
        })
        .strict(),
    },
    toolHandler((args) => client.listOrders(args)),
  );

  server.registerTool(
    "get_order",
    {
      description: "Get a WooCommerce order by its numeric ID.",
      inputSchema: z
        .object({
          id: z.number().int().positive(),
        })
        .strict(),
    },
    toolHandler(({ id }) => client.getOrder(id)),
  );

  server.registerTool(
    "update_order_status",
    {
      description:
        "Update an order status to one of the supported WooCommerce statuses.",
      inputSchema: z
        .object({
          id: z.number().int().positive(),
          status: orderStatusSchema,
        })
        .strict(),
    },
    toolHandler(({ id, status }) =>
      client.updateOrderStatus(id, status),
    ),
  );
}
