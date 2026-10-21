# PROGRESS (agents: tick ONLY with passing acceptance evidence)
Deadline 26 Oct 2026. Order matters; do not start a task before its dependencies.

- [x] T00 Repo + local cluster + secrets script      (15 Oct)
- [x] T01 WordPress + WooCommerce + MariaDB chart     (15–16 Oct)
- [x] T02 woo-mcp server                              (17–18 Oct)
- [x] T03 Gateway: data, auth, keys, servers CRUD, audit (19–20 Oct)
- [x] T04 Gateway: MCP aggregation + routing + failure handling (20–21 Oct)
- [x] T05 Extra upstreams mcp-time + mcp-notes        (21–22 Oct)
- [ ] T06 Dashboard                                   (22–23 Oct)
  - Required acceptance subtask: `docs/tasks/T06A-member-disable-endpoint.md`.
- [ ] T07 Chat agent                                  (23–24 Oct)
- [ ] T08 NetworkPolicy + hardening                   (24–25 Oct)
- [ ] T09 Prod values + upgrade/rollback docs         (25 Oct)
- [ ] T10 Docs, demo rehearsal, video, submit         (25–26 Oct)

Optional stand-outs (ONLY after T10 core is green): SSRF guard on admin URLs; per-role tool permissions.
