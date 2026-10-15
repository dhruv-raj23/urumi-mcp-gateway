# T05 — Two extra upstream MCP servers
**Depends on:** T04
**Allowed paths:** `apps/mcp-time/`, `apps/mcp-notes/`, `charts/urumi/templates/mcp-{time,notes}-*`
**Do:** mcp-time tools `get_current_time`, `convert_timezone`, `echo`; mcp-notes tools `add_note`, `list_notes`, `echo` (notes in memory or tiny PVC; document the choice). Streamable HTTP, `/healthz`, optional bearer, Dockerfile, chart (ClusterIP only). Register both in the gateway (seed or via API).
**Acceptance:** dashboard/API lists woo, time, notes (3 servers); one prompt needs two servers (orders → `notes__add_note`) and works end-to-end; both `echo` tools visible with distinct names.
