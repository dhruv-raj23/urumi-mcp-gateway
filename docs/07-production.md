# 07 — Production (k3s VPS) and upgrades (SKELETON — complete in T09)
- What changes via `values-prod.yaml` only: domain, ingress class/TLS, storageClass, image registry/tags, resources, `COOKIE_SECURE`.
- Secrets creation on VPS (`scripts/create-secrets.sh`), DNS records, optional cert-manager.
- Upgrade: `helm upgrade --install urumi charts/urumi -n urumi -f charts/urumi/values-prod.yaml`; rollback: `helm rollback urumi <rev>`; show `helm history`.
