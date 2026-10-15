# T04 — Gateway MCP aggregation, routing, failure handling
**Depends on:** T02, T03
**Allowed paths:** `apps/gateway/src/mcp/`, `apps/gateway/src/health/`, tests
**Do:** `aggregator.ts` (listTools(user), callTool(user, source, name, args)); stateless `/mcp` per ADR-0002; naming per contracts §5; parallel list with per-server timeout;
call timeout; health loop; statuses; audit every call incl. denied/timeout; strip client Authorization before upstream; upstream credential injection (none/bearer/header).
**Acceptance:**
- Tests: collision (`time__echo` vs `notes__echo`), timeout returns `isError`, dead server omitted but others listed, disabled server tools gone, revoked key → 401
- Inspector via gateway with a member key lists woo tools and `woo__list_orders` returns data
- Kill woo-mcp pod → `tools/list` still fast and returns other servers; dashboard API shows `unreachable` with reason
