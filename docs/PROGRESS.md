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
- [ ] T10 Fresh-copy README rehearsal, final two-user demo recording and submission

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

## Remaining acceptance work

- [ ] Rehearse the complete README from a clean working copy without removing
      or resetting the active assignment cluster.
- [ ] Rehearse the two-user demo twice: User A must be a member using chat;
      User B must be a distinct member using an external MCP client.
- [ ] Record and review the final demo video, checking for visible credentials
      and customer-identifying data.
- [ ] Submit the video and repository through the assignment form.
- [ ] Check off R24 and R25 only after video and fresh-copy evidence exist.

## Known limitations and unverified production work

A real VPS deployment, public pullability of the configured GHCR image tags,
production DNS/TLS and production backup/restore remain unverified.
Comprehensive SSRF destination filtering, per-role/per-tool permissions and
comprehensive per-user rate limiting are not implemented.

## Stand-out items attempted

NetworkPolicy hardening, a local Helm upgrade/rollback rehearsal, and
idempotent default WooCommerce server registration are implemented and
documented. The SSRF guard and per-role tool authorization remain future work.
