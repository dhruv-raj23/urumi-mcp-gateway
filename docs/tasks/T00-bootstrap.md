# T00 — Repo bootstrap, local cluster, secrets script
**Depends on:** none
**Goal:** reproducible local cluster and secret creation.
**Allowed paths:** `scripts/`, `Makefile`, `.github/`, `README.md`, `docs/`
**Do:**
1. Install/verify: docker, k3d, kubectl, helm, node 20.
2. Implement `scripts/cluster-up.sh` (k3d cluster `urumi`, `-p "80:80@loadbalancer"`, 1 server) and `scripts/cluster-down.sh`.
3. Implement `scripts/create-secrets.sh` per contracts §3: generates random values with `openssl rand`, reads `LLM_API_KEY` and `BOOTSTRAP_ADMIN_PASSWORD` from env (fails clearly if missing), creates namespace `urumi`, is idempotent (`--dry-run=client -o yaml | kubectl apply -f -`). Prints NO secret values.
4. Verify `scripts/check-secrets.sh` and `make scaffold-verify` pass.
**Acceptance:**
- `make cluster-up && kubectl get nodes` shows Ready
- `LLM_API_KEY=x BOOTSTRAP_ADMIN_PASSWORD=y make secrets && kubectl -n urumi get secrets` lists the 6 secrets from contracts §3
- `make check` passes
**Out of scope:** any app code.
