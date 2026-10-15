# T01 — WordPress + WooCommerce + MariaDB on Kubernetes
**Depends on:** T00
**Goal:** working storefront at `http://store.localhost` with persistent storage and a COD checkout.
**Allowed paths:** `charts/urumi/`, `docs/adr/ADR-0003*`, `docs/OPEN_QUESTIONS.md`
**Do:**
1. Templates: mariadb (StatefulSet+PVC), wordpress (Deployment/StatefulSet+PVC for wp-content), Services, Ingress `store.*`, probes, limits.
2. Init Job (Helm hook or idempotent Job) using WP-CLI image: `wp core install`, install+activate WooCommerce, enable COD, set currency, permalinks, seed the API key row from Secret `urumi-woo-api` (ADR-0006). Must be safe to re-run.
3. Resolve OPEN_QUESTIONS (T01) REST-over-HTTP auth by testing a real `curl` with the consumer key from inside the cluster; record outcome in ADR-0003.
**Acceptance:**
- `helm lint` + `helm template` clean for both values files
- `kubectl -n urumi get pods,pvc` → all Running/Ready, PVCs Bound
- `curl -s http://store.localhost/ | head` returns the storefront
- Manual: add product to cart, checkout with COD; order visible in WP admin
- Delete the wordpress and mariadb pods → data (order) still present afterwards
- In-cluster: `curl -u $KEY:$SECRET http://wordpress/wp-json/wc/v3/products` returns JSON (or the chosen auth variant does)
**Out of scope:** MCP, gateway.
