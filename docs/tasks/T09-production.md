# T09 — Production values and upgrade/rollback
**Depends on:** T08
**Allowed paths:** `charts/urumi/values-prod.yaml`, `docs/07-production.md`, `README.md`
**Do:** complete `values-prod.yaml` (domain, ingress class, storageClass, registry/tags, resources, COOKIE_SECURE=true, optional cert-manager annotations); document VPS (k3s) steps; demonstrate `helm upgrade` then `helm rollback` locally with a visible change (e.g. image tag or replica value).
**Acceptance:** `helm template -f values-prod.yaml` renders; `helm history urumi -n urumi` shows an upgrade + rollback; diff of local vs prod values documented. (Actual VPS deploy = bonus if time.)
