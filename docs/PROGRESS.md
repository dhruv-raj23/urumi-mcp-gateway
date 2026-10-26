# PROGRESS

Deadline: 26 October 2026. See `docs/01-requirements-traceability.md` for
requirement-by-requirement evidence and remaining acceptance work.

- [x] T00 Repo, local cluster and Secrets script
- [x] T01 WordPress, WooCommerce, MariaDB, persistence and ingress
- [x] T02 Woo MCP server and five tools
- [x] T03 Gateway data, authentication, API keys, server management and audit
- [x] T04 MCP aggregation, routing, timeouts and failure handling
- [x] T05 Time and Notes upstream MCP servers
- [x] T06 Dashboard management and browser acceptance
- [x] T07 Chat agent, bounded tool loop and user-aware audit attribution
- [x] T08 NetworkPolicy and workload hardening
- [x] T09 Production values and local Helm upgrade/rollback rehearsal
- [ ] T10 Final submission (README rehearsal and demo review completed; assignment-form submission remains pending)

## Verification recorded on 24 October 2026

- Gateway default WooCommerce registration deployed as
  `urumi/gateway:t10-default-woo-20261024-1`, Helm revision 39.
- Gateway `/healthz` returned HTTP 200; dashboard and storefront returned
  HTTP 200; all eight application pods were Ready in the recorded checks.
- Live registry contained `woo`, `time`, and `notes`, enabled and Connected.
- Default Woo registration passed six focused tests, including encrypted
  credential storage, preservation of existing configuration and concurrent
  registration handling.
- Fresh-registration verification against a temporary MongoDB collection
  passed. The marker confirmed insertion, encrypted credential storage and
  repeat-startup idempotency; the temporary collection was removed.
- Persistence verification passed for MongoDB, MariaDB and WordPress content:
  each temporary marker survived pod recreation and was cleaned up afterward.
- Repository validation passed: 185 tests, TypeScript typecheck, scaffold
  verification, secret scan, chart policy check, Helm lint/render and
  `git diff --check`.
- Local Helm upgrade/rollback rehearsal previously recorded revisions
  36 → 37 → 38. The gateway update was subsequently deployed at revision 39.
- The lint targets still print a TODO; ESLint is not configured.

## Observability implementation — 25 October 2026

- [x] Added a process-local Prometheus-format tool metrics collector.
- [x] Added per-server/outcome call counters and latency histograms.
- [x] Added internal GET /metrics and HTTP tests for text output and method rejection.
- [x] Focused tests passed: 84; gateway TypeScript typecheck passed.
- [x] Full make check passed with 198 automated tests and repository checks.
- [x] Deployed `urumi/gateway:observability-20261025-1` at Helm revision 41.
- [x] Live `GET /healthz` and `GET /metrics` checks passed.
- [x] A successful time tool call incremented the success counter; a denied
      member WooCommerce write call incremented the denied counter.
- [ ] Prometheus scraping is not configured; metrics reset on restart and
      are not aggregated across replicas.

## Final repository validation — 26 October 2026

- `make check` completed with 220 automated tests passing: gateway 191, Woo MCP 9,
  Time 6, Notes 5, and Dashboard 9.
- Scaffold verification and the repository secret scan passed.
- Helm lint passed for local and production values; chart policy passed for 9 workloads
  and 22 containers/init containers across two rendered configurations.
- Lint scripts still emit `TODO(T00+): configure eslint`; ESLint is not configured,
  so this is not an ESLint pass.
- `git diff --check` passed after the initial documentation corrections.

## Remaining acceptance work

- [x] Rehearse the README from a clean checkout using the isolated
      `urumi-rehearsal` cluster; Helm revision 2 deployed, application pods
      became Ready, both HTTP endpoints returned 200, and the user confirmed
      the dashboard, WooCommerce and Antigravity MCP acceptance flows.
- [x] Review the recorded video and verify the two-user flow: User A (admin)
      uses chat for product creation; User B (member) uses external MCP. Confirm
      `source=chat` and `source=mcp` are attributed to the correct users.
- [x] Record the final demo video on 26 October 2026.
- [x] Review the full video for required flows, correct audit identities, and
      visible credentials or customer-identifying data.
- [ ] Submit the video and repository through the assignment form.
- [x] R24 video recording and review completed.
- [x] R25 clean-copy README rehearsal completed on 26 October 2026.

## Known limitations and unverified production work

A real VPS deployment, public pullability of the configured GHCR image tags,
production DNS/TLS and production backup/restore remain unverified.
Role-based tool authorization is implemented with a fixed allowlist and
tested at the policy, aggregator and dashboard metadata layers.
Application-level SSRF destination checks are implemented and tested;
production egress enforcement and IPv6 behavior remain unverified.
Comprehensive per-user rate limiting remains unimplemented.

## Stand-out items attempted

NetworkPolicy hardening, a local Helm upgrade/rollback rehearsal,
idempotent default WooCommerce server registration, fixed role-based tool
authorization and application-level SSRF destination checks are implemented
and documented. Production egress enforcement and IPv6 behavior remain
unverified; comprehensive per-user rate limiting remains future work.
