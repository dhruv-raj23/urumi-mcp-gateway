# T08 — NetworkPolicies and hardening
**Depends on:** T05, T06
**Allowed paths:** `charts/urumi/templates/networkpolicy*`, `charts/urumi/templates/*`, `scripts/check-chart.sh`
**Do:** default-deny in namespace; allow ingress-controller → wordpress/dashboard/gateway; gateway → mongo, woo-mcp, mcp-time, mcp-notes; woo-mcp → wordpress; wordpress → mariadb; DNS egress. Ensure securityContexts (non-root, drop caps). Note: k3d default CNI (flannel) may not enforce NetworkPolicy — k3s includes a network policy controller; verify and document actual behavior.
**Acceptance:** from a throwaway pod, `curl woo-mcp:3001/healthz` is BLOCKED; from gateway pod it succeeds; `scripts/check-chart.sh` confirms probes, resources, non-root on every workload.

## Implementation and validation record

- Added Helm-managed NetworkPolicies behind `networkPolicy.enabled`.
- The default chart setting remains disabled; local validation enables it.
- The enabled render contains 14 NetworkPolicy resources; the disabled
  render contains zero.
- Kubernetes server-side dry-run validation passed for all 14 policies.
- Applied the local configuration successfully with Helm revision 36.
- Before policy deployment, a throwaway pod successfully reached
  `woo-mcp:3001/healthz`. After deployment, the same access was denied,
  while the gateway continued to receive HTTP 200. The post-deployment
  ordinary-pod request returned `Connection refused`; the gateway's
  permitted request succeeded and the WooCommerce endpoint was present.
- DNS resolution for the fully qualified WooCommerce Service name succeeded.
- Gateway health checks for WooCommerce MCP, time MCP and notes MCP returned
  HTTP 200. WooCommerce MCP reached WordPress successfully.
- Dashboard and storefront returned HTTP 200.
- The Gemini hostname was reachable over HTTPS. A request to its root path
  returned HTTP 404; this checks network reachability, not authenticated
  API functionality.
- The read-only chat workflow completed `woo.list_products` in 1,634 ms.
  Audit persistence was verified for `admin@example.com`.
- `make check` passed: 150 gateway tests, 9 WooCommerce MCP tests,
  6 time MCP tests, 5 notes MCP tests and 9 dashboard tests (179 total).
- Chart policy validation covered Deployments, StatefulSets, the bootstrap
  Job and init containers. ESLint remains unconfigured.
- Egress to TCP 443 is permitted to any IPv4 destination for the gateway
  and WordPress bootstrap Job. This is not hostname-specific filtering
  for Gemini or WordPress.org.
- The live tests demonstrate the intended traffic restriction in this
  local k3d cluster. Repeat the enforcement checks if the cluster or CNI
  configuration changes.

## Additional SSRF and workload hardening record — 25 October 2026

The `feat/ssrf-hardening` branch adds application-level upstream
destination checks and additional workload/chart controls.

- Added shared destination validation for server registration, built-in
  upstream definitions and outbound MCP connections.
- Restricted the first-party HTTP exception to the expected service slug,
  fully qualified Kubernetes Service hostname, port and `/mcp` path.
- Required external upstreams to use HTTPS on the default port, rejected
  unsafe host forms and URL credentials, and validated resolved addresses
  when connections are made. Unsafe or mixed public/private DNS answers
  are rejected.
- Configured safe upstream fetching to reject destination changes and
  disable automatic redirects.
- Added IPv4 exclusions for private and other non-public destination ranges
  to the relevant broad TCP 443 egress rules. This is defense-in-depth, not a
  hostname allowlist or a complete IPv4/IPv6 egress policy.
- Set `automountServiceAccountToken: false` on nine rendered workloads.
  Chart checks cover nine workloads and 22 containers/init containers.
- `npm audit --omit=dev` reported zero production dependency vulnerabilities
  at the time of validation.

Recorded branch validation:

- `make check` passed with 187 gateway tests, 9 WooCommerce MCP tests,
  6 time MCP tests, 5 notes MCP tests and 9 dashboard tests (216 total).
- Gateway TypeScript type-check passed.
- `git diff --check` passed.
- Local and production Helm lint/render checks passed.
- Chart policy checks and the repository secret scan passed.

These results are branch validation, not proof of a live deployment. The
currently running local Helm release has intentionally been left unchanged.
For runtime acceptance, deploy the reviewed branch through the normal rollout
procedure, verify pod readiness and health, and repeat allowed/blocked
destination tests from the gateway and a non-privileged throwaway pod.
Record the actual Helm revision and observed results only after those checks
have run.
