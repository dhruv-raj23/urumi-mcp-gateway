#!/usr/bin/env bash
# Lint + render the chart for both values files; verify probes/resources/non-root on workloads.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v helm >/dev/null || { echo "helm not installed - skipping chart check"; exit 0; }
for v in values-local.yaml values-prod.yaml; do
  helm lint charts/urumi -f charts/urumi/$v
  helm template urumi charts/urumi -n urumi -f charts/urumi/$v > /tmp/urumi-$v.out
done
python3 - <<'PY'
import sys
try:
    import yaml
except ImportError:
    print("PyYAML missing - skipping workload policy check"); sys.exit(0)
bad = []
for f in ["/tmp/urumi-values-local.yaml.out", "/tmp/urumi-values-prod.yaml.out"]:
    for d in yaml.safe_load_all(open(f)):
        if not d or d.get("kind") not in ("Deployment", "StatefulSet"): continue
        name = d["metadata"]["name"]
        spec = d["spec"]["template"]["spec"]
        for c in spec.get("containers", []):
            for k in ("readinessProbe", "livenessProbe"):
                if k not in c: bad.append(f"{name}/{c['name']}: missing {k}")
            r = c.get("resources", {})
            if not r.get("requests") or not r.get("limits"): bad.append(f"{name}/{c['name']}: missing requests/limits")
            sc = {**spec.get("securityContext", {}), **c.get("securityContext", {})}
            if sc.get("runAsNonRoot") is not True and not sc.get("runAsUser"):
                bad.append(f"{name}/{c['name']}: not forced non-root")
if bad:
    print("CHART POLICY VIOLATIONS:"); [print(" -", b) for b in sorted(set(bad))]; sys.exit(1)
print("chart policy ok")
PY
