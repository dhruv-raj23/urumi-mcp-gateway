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

## Remaining acceptance tasks

- [ ] Rehearse the README workflow from a clean working copy. Do not delete
      the active assignment cluster or persistent volumes.
- [ ] Rehearse the complete two-user flow twice:
      User A uses chat; User B is a distinct user using external MCP.
- [ ] Confirm User A's audit entries have `source=chat` and User B's have
      `source=mcp`.
- [ ] Record the final demo video and review it for visible credentials,
      passwords, tokens and customer-identifying data.
- [ ] Confirm all workloads/upstreams are healthy after the rehearsal.
- [ ] Submit the video and GitHub repository using
      https://forms.gle/nftwgyNeenSDmiRb6.

## Explicitly unverified

- A real VPS deployment, production DNS/TLS, and public pullability of the
  configured GHCR image tags have not been demonstrated.
- Comprehensive SSRF destination filtering, per-role/per-tool permissions
  and comprehensive per-user rate limiting are not implemented.
- ESLint is not configured; the repository lint scripts are TODO stubs.
