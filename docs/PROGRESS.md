# PROGRESS (agents: tick ONLY with passing acceptance evidence)
Deadline 26 Oct 2026. Order matters; do not start a task before its dependencies.

- [x] T00 Repo + local cluster + secrets script      (15 Oct)
- [x] T01 WordPress + WooCommerce + MariaDB chart     (15–16 Oct)
- [x] T02 woo-mcp server                              (17–18 Oct)
- [x] T03 Gateway: data, auth, keys, servers CRUD, audit (19–20 Oct)
- [x] T04 Gateway: MCP aggregation + routing + failure handling (20–21 Oct)
- [x] T05 Extra upstreams mcp-time + mcp-notes        (21–22 Oct)
- [x] T06 Dashboard — dashboard and browser acceptance verified (21 Oct 2026)
  - [x] T06A member-disable endpoint — commit `2b5bee9`; gateway image `t06a-user-disable-20261021-1` deployed.
  - Dashboard image `t06-20261021-5` deployed at Helm revision 29; browser workflows verified.
- [ ] T07 Chat agent                                  (23–24 Oct)
- [ ] T08 NetworkPolicy + hardening                   (24–25 Oct)
- [ ] T09 Prod values + upgrade/rollback docs         (25 Oct)
- [ ] T10 Docs, demo rehearsal, video, submit         (25–26 Oct)

Optional stand-outs (ONLY after T10 core is green): SSRF guard on admin URLs; per-role tool permissions.
