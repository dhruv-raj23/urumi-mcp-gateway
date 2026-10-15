# T02 — WooCommerce MCP server
**Depends on:** T01
**Allowed paths:** `apps/woo-mcp/`, `charts/urumi/templates/woo-mcp-*`, `docs/adr/ADR-0003*`
**Do:** Streamable HTTP at `POST /mcp`, `GET /healthz`; bearer check using `UPSTREAM_AUTH_TOKEN`; five tools per contracts §5/§12
with zod input schemas, REST client for WooCommerce (timeouts, clear errors, no secret in errors), Dockerfile (non-root), chart (ClusterIP only, NO ingress).
**Acceptance:**
- `cd apps/woo-mcp && npm test` passes (mock WC server tests per tool)
- Inspector against port-forward lists exactly 5 tools; `create_product` creates a product visible on storefront; `list_orders` with today's `after` returns the hand-placed order
- `curl http://woo-mcp...` from outside the cluster is impossible (no Ingress, ClusterIP)
- Calls without correct bearer → 401
