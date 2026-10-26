# 01 — Requirements traceability

Mandatory requirements from `docs/00-assignment.md`, with task mapping and
evidence. A checked item has implementation or acceptance evidence. An
unchecked item still needs the evidence described below.

| # | Requirement | Task | Proof / evidence | Done |
|---|---|---|---|---|
| R1 | Runs on local Kubernetes (k3d) | T00 | `kubectl config current-context`; `kubectl get nodes` | [x] |
| R2 | Same Helm chart for VPS, local/prod values, no Kustomize | T01,T09 | `scripts/check-chart.sh`; lint/render both values files; `docs/07-production.md` | [x] |
| R3 | All application workloads run in cluster | T01–T07 | `kubectl get pods -n urumi`; eight application pods Ready in latest check | [x] |
| R4 | Persistent storage for databases and WordPress content | T01 | `data-mongo-0`, `data-mariadb-0`, and `wordpress-content` PVCs Bound; temporary markers survived pod recreation for MongoDB, MariaDB, and WordPress content | [x] |
| R5 | Stable store/dashboard ingress URLs and local domain approach | T01,T06 | `curl` to `store.localhost` and `app.localhost` returned HTTP 200; README documents hostname troubleshooting | [x] |
| R6 | Probes and resource requests/limits on workloads | T01–T08 | `scripts/check-chart.sh`; 9 workloads and 22 containers/init containers checked across two renders | [x] |
| R7 | No hardcoded secrets; Kubernetes Secrets | T00,all | `scripts/check-secrets.sh`; `scripts/create-secrets.sh`; Secrets referenced by chart | [x] |
| R8 | Woo MCP implemented over Streamable HTTP | T02 | `apps/woo-mcp/tests/server.test.ts`; external MCP client acceptance | [x] |
| R9 | Five required Woo product/order tools | T02 | Woo MCP tests; `docs/03-contracts.md` sections 5 and 12 | [x] |
| R10 | Woo MCP is not publicly exposed | T02,T08 | No public Woo MCP Ingress; NetworkPolicy validation and unauthorized-pod isolation documented in T08 | [x] |
| R11 | Document Woo MCP-to-store communication and rationale | T02,T10 | `docs/adr/ADR-0003-woo-rest-api.md`; README; `docs/02-architecture.md` | [x] |
| R12 | Admin can add/edit/disable/remove upstreams | T03,T06 | Gateway API tests and dashboard management tests; `docs/03-contracts.md` | [x] |
| R13 | Single client MCP endpoint aggregates/routes tools | T04 | MCP client connected to `http://app.localhost/mcp`; 11 tools listed in acceptance | [x] |
| R14 | Duplicate tool names disambiguated | T04,T05 | `apps/gateway/tests/toolNaming.test.ts`; `time__echo` and `notes__echo` | [x] |
| R15 | Slow/dead upstream does not break independent upstreams | T04,T05 | Time upstream taken down; dashboard reported it unreachable while Woo and Notes continued; aggregator timeout tests | [x] |
| R16 | Upstream credentials never reach browser or MCP client | T03,T04 | Credential/security tests; contracts and threat model | [x] |
| R17 | At least three upstream MCP servers | T05 | Live registry showed `woo`, `time`, `notes` enabled and Connected | [x] |
| R18 | Admin/member roles | T03 | Authentication/bootstrap tests, dashboard management tests, contracts | [x] |
| R19 | Per-user API keys hashed and revocable | T03 | Key/security tests; revoked key returned HTTP 401; replacement key succeeded | [x] |
| R20 | Audit log of calls visible in dashboard | T03,T04,T06 | Dashboard audit test; observed attributed `mcp` and `chat` records | [x] |
| R21 | Chat agent tool loop and visible tool calls | T07 | Gateway chat tests, dashboard tests and local chat acceptance | [x] |
| R22 | Chat acts as signed-in user and records attribution | T07 | Local audit evidence identified the chat actor and `source=chat`; final video review should confirm attribution to the signed-in User A (admin) | [x] |
| R23 | LLM key stored in Kubernetes Secret | T00,T07 | `urumi-gateway` Secret wiring and chart/secret scans | [x] |
| R24 | Two-user end-to-end demo video | T10 | Video recorded locally on 26 October 2026; final review of user identities, audit attribution, required flows and secret redaction remains | [ ] |
| R25 | README covers local, VPS, order, external client and chat | T10 | README written; rehearse the complete setup from a clean working copy before checking complete | [ ] |
| R26 | System design and trade-offs note | T10 | `docs/05-design-and-tradeoffs.md` | [x] |
| R27 | Threat model covers the four required topics | T10 | `docs/04-threat-model.md` | [x] |
| R28 | Local-to-VPS story and Helm upgrade/rollback | T09,T10 | `docs/07-production.md`; local revisions 36 → 37 → 38 documented | [x] |

## Additional engineering evidence

- Tool-call observability has automated tests for Prometheus counters,
  cumulative latency histogram buckets, safe server labels and the HTTP route.
- `make check` passed with 198 automated tests, plus repository, secret and
  chart-policy checks; gateway TypeScript typecheck passed.
- Live verification passed on k3d at Helm revision 41. A successful time
  tool call incremented the success counter, and a denied WooCommerce write
  attempt incremented the denied counter. Prometheus scraping is not configured.

## Remaining acceptance evidence

- **R24:** Review the recorded video to verify the required flows, distinct user
  identities, `source=chat`/`source=mcp` audit attribution, and absence of visible
  credentials or customer-identifying data. Keep this unchecked until reviewed.
- **R25:** Follow the README from a clean working copy. The local deploy target
  was aligned with locally built `:dev` tags; the fresh-copy walkthrough is
  still outstanding.

R4 persistence evidence is recorded in the requirements table above.

Local k3d acceptance does not establish a live production deployment. GHCR
image pullability, production DNS/TLS and a real VPS rollout remain unverified.
Role-based tool authorization is implemented using a fixed admin/member
allowlist. Evidence: `apps/gateway/src/mcp/toolPermissions.ts`,
`apps/gateway/tests/toolPermissions.test.ts`, aggregator tests and HTTP
metadata-filtering tests. Application-level SSRF URL, DNS-destination and
redirect checks are implemented and tested; production NetworkPolicy
enforcement and IPv6 behavior remain unverified. Comprehensive per-user
rate limiting remains unimplemented.
