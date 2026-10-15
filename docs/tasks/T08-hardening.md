# T08 — NetworkPolicies and hardening
**Depends on:** T05, T06
**Allowed paths:** `charts/urumi/templates/networkpolicy*`, `charts/urumi/templates/*`, `scripts/check-chart.sh`
**Do:** default-deny in namespace; allow ingress-controller → wordpress/dashboard/gateway; gateway → mongo, woo-mcp, mcp-time, mcp-notes; woo-mcp → wordpress; wordpress → mariadb; DNS egress. Ensure securityContexts (non-root, drop caps). Note: k3d default CNI (flannel) may not enforce NetworkPolicy — k3s includes a network policy controller; verify and document actual behavior.
**Acceptance:** from a throwaway pod, `curl woo-mcp:3001/healthz` is BLOCKED; from gateway pod it succeeds; `scripts/check-chart.sh` confirms probes, resources, non-root on every workload.
