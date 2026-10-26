# T10 — Documentation, demo rehearsal and submission

**Depends on:** T09

## Documentation completed

- [x] README covers local setup, storefront orders, chat, external MCP clients,
      production-like VPS setup and known limitations.
- [x] Threat model covers shared upstream credentials, token separation,
      malicious tool descriptions/results, team-member boundaries and SSRF risk.
- [x] Design and trade-offs document explains architecture, aggregation,
      routing, failure handling and local-to-production differences.
- [x] Requirement traceability includes evidence and remaining acceptance work.
- [x] Demo script defines the two-user acceptance walkthrough.
- [x] Local `make deploy` uses the `:dev` image tags produced by `make build`
      and imported by `make load`.
- [x] Default WooCommerce registration is documented and tested, including
      encrypted credential storage and idempotent repeat startup.

## Verification evidence completed

- [x] `make check` passed: 185 automated tests plus repository, secret and
      chart-policy checks. The lint target remains a TODO stub.
- [x] Helm lint and local rendering passed.
- [x] Gateway startup and health check passed; dashboard and storefront
      returned HTTP 200.
- [x] Live registry showed `woo`, `time` and `notes` enabled and Connected.
- [x] MongoDB, MariaDB and WordPress content survived their respective pod
      recreation tests using temporary markers; test data was cleaned up.
- [x] Local Helm upgrade and rollback evidence is recorded in
      `docs/07-production.md`.

### Observability addendum — 25 October 2026

- [x] Metrics collector tests cover counters, histogram buckets, latency
      sum/count, safe labels and the empty initial state.
- [x] HTTP tests cover Prometheus text output and rejection of non-GET
      requests to /metrics.
- [x] Focused tests passed: 84; full make check passed with 198 automated
      tests; gateway TypeScript typecheck passed.
- [x] Deployed urumi/gateway:observability-20261025-1 at Helm revision 41;
      /healthz and /metrics returned HTTP 200 via port-forward.
- [x] A live read-only time tool call incremented the success counter; a denied
      member woo__create_product call incremented the denied counter.
- [ ] Prometheus scraping remains unconfigured. Metrics are process-local,
      reset on restart and not aggregated across replicas.

## Remaining acceptance tasks

- [ ] Rehearse the README workflow from a clean working copy. Do not delete
      the active assignment cluster or persistent volumes.
- [x] Verify the recorded two-user flow and audit attribution: User A (admin)
      uses chat for product creation; User B (member) uses external MCP with
      their own API key. Confirm `source=chat` and `source=mcp` are attributed
      to the correct users.
- [x] Record the final demo video locally on 26 October 2026.
- [x] Review the complete video for required flows, correct user and audit
      attribution, and visible credentials, passwords, tokens or customer data.
- [ ] Confirm all workloads/upstreams are healthy after the rehearsal.
- [ ] Submit the video and GitHub repository using
      https://forms.gle/nftwgyNeenSDmiRb6.

## Explicitly unverified

- A real VPS deployment, production DNS/TLS, and public pullability of the
  configured GHCR image tags have not been demonstrated.
- Fixed role-based tool authorization is implemented and tested; the policy
  is not configurable per user. Application-level SSRF URL, DNS-destination
  and redirect checks are implemented and tested. Production egress enforcement
  and IPv6 behavior remain unverified; comprehensive per-user rate limiting
  remains unimplemented.
- ESLint is not configured; the repository lint scripts are TODO stubs.
