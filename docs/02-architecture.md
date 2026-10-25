# 02 — Architecture

```
 Browser ──► Ingress(app.*) ─┬─ /      ─► dashboard (nginx, React)
                             ├─ /api   ─► gateway ─┐
 MCP client (Claude Code,    └─ /mcp   ─► gateway ─┤  (Bearer API key)
 Cursor, Inspector)                                │
                                  gateway = MCP server (client-facing) + MCP client (upstream)
                                  + REST API + auth + audit + chat agent
                                      │  Streamable HTTP, per-upstream credential, timeouts
              ┌───────────────────────┼───────────────────────┐
           woo-mcp                 mcp-time               mcp-notes        (ClusterIP only, NetworkPolicy: gateway → them)
              │ WooCommerce REST v3
         wordpress(+woocommerce) ─► mariadb (PVC)          gateway ─► mongo (PVC)
 Browser ──► Ingress(store.*) ─► wordpress (PVC)
```

## Responsibilities
- **gateway**: single trust boundary. Authenticates users (cookie) and clients (API key), holds upstream credentials
  (encrypted), aggregates/routes tools, enforces timeouts, audits, hosts the chat loop.
- **woo-mcp**: translates MCP tool calls to WooCommerce REST. Holds WC consumer key/secret. Knows nothing about users.
- **mcp-time / mcp-notes**: tiny upstreams proving multi-server aggregation + name collision (`echo`).
- **dashboard**: UI only; no secrets; same-origin calls to `/api`.
- **mongo**: users, keys(hashes), servers(enc creds), audit.

## Tool call path (client → store → client)
1. Client `POST /mcp` `tools/call name=woo__list_orders` with `Bearer urumi_…`.
2. Gateway hashes key → finds active key → user. 3. Splits name → slug `woo`, tool `list_orders`.
4. Loads server (enabled & connected), decrypts credential in memory. 5. Opens Streamable HTTP request to
`http://woo-mcp.urumi.svc.cluster.local:3001/mcp` with the **upstream** credential (never the client key), with timeout.
6. woo-mcp calls WordPress REST, returns result. 7. Gateway writes audit row (user, server, tool, duration, outcome)
and returns result (or `isError` result) to the client.

## Failure handling
- List: parallel with per-server timeout; failed servers omitted + marked unreachable with reason.
- Call: timeout → `isError` "upstream timed out after Nms"; audit outcome `timeout`.
- Health loop updates `status`; dashboard polls `/api/servers`.
