# Kubernetes / Helm rules
- Helm only. Templates in `charts/urumi/templates/<component>-*.yaml`; shared labels in `_helpers.tpl`.
- Every workload: `readinessProbe` + `livenessProbe`, `resources.requests` + `limits`, `securityContext` (non-root),
  `imagePullPolicy` from values. Stateful sets/PVCs use `persistence.*` values.
- Services default to ClusterIP. Only `wordpress`, `dashboard`, `gateway` get Ingress rules (contracts §2).
- No secret values in templates/values. Use `valueFrom.secretKeyRef` with `existingSecret` names (contracts §3).
- Anything that differs local vs prod is a value. No `if .Values.env == "local"` branching in templates.
- Always run: `helm lint charts/urumi -f charts/urumi/values-local.yaml` and `helm template` for both values files.
- Verify with real cluster commands (`kubectl rollout status`, `kubectl get pvc`, `kubectl describe`), not assumptions.
- Local images: build as `urumi/<app>:dev`, load with `k3d image import -c urumi`.
