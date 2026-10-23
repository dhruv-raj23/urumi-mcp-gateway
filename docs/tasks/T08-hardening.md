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
