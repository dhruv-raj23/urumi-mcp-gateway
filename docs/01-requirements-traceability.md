# 01 — Requirements traceability
Every mandatory item from `docs/00-assignment.md` mapped to the task that delivers it and how to prove it.
Tick only with evidence (command output / screenshot path). Owner: AJ.

| # | Requirement (from brief) | Task | Proof | Done |
|---|---|---|---|---|
| R1 | Runs on local K8s (k3d) | T00 | `kubectl get nodes` | [ ] |
| R2 | Same Helm chart for VPS; values-local/prod; no Kustomize | T01,T09 | `helm template -f values-prod.yaml` ok | [ ] |
| R3 | All workloads in cluster | T01–T07 | `kubectl -n urumi get pods` | [ ] |
| R4 | Persistent storage for DB + WP content | T01 | PVCs Bound; pod delete keeps data | [ ] |
| R5 | Ingress stable URLs for store + dashboard; local domain approach documented | T01,T06 | curl `store.localhost`, `app.localhost` | [ ] |
| R6 | Readiness/liveness + requests/limits on every workload | T01–T07,T08 | `scripts/check-chart.sh` | [ ] |
| R7 | No hardcoded secrets; K8s Secrets | T00,all | `scripts/check-secrets.sh` | [ ] |
| R8 | Woo MCP written by me, Streamable HTTP | T02 | MCP Inspector lists 5 tools | [ ] |
| R9 | Woo MCP tools: list products, create product, list orders, get order, update order status | T02 | tests + Inspector | [ ] |
| R10 | Woo MCP not reachable from outside cluster | T02,T08 | no Ingress; NetworkPolicy; curl from outside fails | [ ] |
| R11 | Document how Woo MCP talks to store and why | T02 | ADR-0003 + README | [ ] |
| R12 | Admin add/edit/disable/remove upstreams, optional static credential | T03,T06 | API tests + UI | [ ] |
| R13 | One MCP endpoint, aggregated tools, routed calls | T04 | Inspector via gateway | [ ] |
| R14 | Duplicate tool name scheme documented | T04,T05 | `time__echo` vs `notes__echo` | [ ] |
| R15 | Slow/dead upstream does not break others; timeouts; clear error | T04 | kill-pod test | [ ] |
| R16 | Upstream creds never reach browser or MCP client | T03,T04 | test: responses contain no credential | [ ] |
| R17 | ≥ 3 upstream servers | T05 | dashboard shows woo,time,notes | [ ] |
| R18 | Roles admin/member | T03 | tests | [ ] |
| R19 | Per-user API keys, revocable, hashed | T03 | DB shows only hash; revoke → 401 | [ ] |
| R20 | Audit log of every call, visible in dashboard | T03,T04,T06 | UI + API test | [ ] |
| R21 | Chat agent with tool loop, shows tools called | T07 | UI | [ ] |
| R22 | Chat acts as logged-in user (audit shows them) | T07 | audit entry `source=chat` | [ ] |
| R23 | LLM key in Secret | T00,T07 | `urumi-gateway` secret | [ ] |
| R24 | Demo flow with two users (see `docs/06-demo-script.md`) | T10 | video | [ ] |
| R25 | README (local, VPS, order, external client, chat) | T10 | file | [ ] |
| R26 | System design & tradeoffs note | T10 | `docs/05-design-and-tradeoffs.md` | [ ] |
| R27 | Threat model note (4 required topics) | T10 | `docs/04-threat-model.md` | [ ] |
| R28 | Local→VPS story, Helm upgrade/rollback | T09 | `docs/07-production.md` | [ ] |
