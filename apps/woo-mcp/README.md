# woo-mcp

An internal-only WooCommerce MCP server using stateless Streamable HTTP.
It serves MCP requests on `POST /mcp` and Kubernetes health checks on
`GET /healthz`, port 3001.

## Tools

- `list_products`: list products with optional search and page size.
- `create_product`: create and publish a simple product.
- `list_orders`: filter orders by date, status, and page size.
- `get_order`: retrieve an order by ID.
- `update_order_status`: set an order to an allowed status.

Page size is capped at 50. Supported statuses are `pending`, `processing`,
`on-hold`, `completed`, `cancelled`, `refunded`, and `failed`.

## Authentication and secrets

Every `POST /mcp` request requires
`Authorization: Bearer <UPSTREAM_AUTH_TOKEN>`. The health endpoint is
unauthenticated for Kubernetes probes.

- `WC_BASE_URL`: configured by Helm; points to the internal WordPress Service.
- `WC_CONSUMER_KEY`: read from Secret `urumi-woo-api`.
- `WC_CONSUMER_SECRET`: read from Secret `urumi-woo-api`.
- `UPSTREAM_AUTH_TOKEN`: read from Secret `urumi-woo-mcp`.

Never put credential values in source code, Helm values, or logs.

## WooCommerce integration

The server uses WooCommerce REST API v3 rather than directly accessing the
database or executing WP-CLI in the WordPress container. It sends
`X-Forwarded-Proto: https` because WordPress is configured to accept
WooCommerce consumer-key authentication over in-cluster HTTP.

This header does not encrypt the network connection. Access to the WordPress
Service must be appropriately restricted by Kubernetes network policy.

The client applies request timeouts and response-size limits and does not
return raw upstream error bodies to MCP clients.

## Development

Run from this directory:

    npm ci
    npm run build
    npm run typecheck
    npm test

Tests use local mock servers and dummy credentials.

## Kubernetes

The Helm chart creates a Deployment and a ClusterIP Service named `woo-mcp`.
It must not create an Ingress for this service; the gateway is its intended
MCP client.
