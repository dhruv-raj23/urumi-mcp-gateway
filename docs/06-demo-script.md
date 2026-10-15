# 06 — Demo script (definition of done, from the brief)
Record in this order. Two users: **A** (member, uses chat) and **B** (member, uses external MCP client). Admin sets up.
1. Architecture + K8s tour: namespaces, Secrets (names only!), PVCs, Ingress, probes/limits, what is public vs internal.
2. Storefront: add to cart → COD checkout → order appears in WP admin.
3. User A chat: "create product <name> priced <x>" → appears on storefront. Place order by hand. "What orders came in today?" → returns it.
4. User B external client (Inspector/Claude Code/Cursor): gateway URL + B's key only → all tools visible → orders question → one prompt using two upstreams (e.g. orders → add_note).
5. Control: revoke B's key → next call rejected. Disable `notes` → tools vanish in chat + client. Delete `woo-mcp` pod → others work, dashboard shows Unreachable.
6. Audit log shows every call attributed correctly (source mcp/chat).
7. Security talk, MCP internals (collision, timeout, dead upstream), local→VPS values diff, helm upgrade/rollback.
