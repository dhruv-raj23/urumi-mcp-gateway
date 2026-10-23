#!/usr/bin/env bash
# Lint and render local/prod charts; verify workload security and resources.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v helm >/dev/null || {
  echo "helm not installed - skipping chart check"
  exit 0
}

for v in values-local.yaml values-prod.yaml; do
  helm lint charts/urumi -f "charts/urumi/$v"
  helm template urumi charts/urumi \
    -n urumi -f "charts/urumi/$v" > "/tmp/urumi-$v.out"
done

python3 - <<'PY'
import sys

try:
    import yaml
except ImportError:
    print("PyYAML missing - skipping workload policy check")
    sys.exit(0)

files = [
    "/tmp/urumi-values-local.yaml.out",
    "/tmp/urumi-values-prod.yaml.out",
]

long_running = {"Deployment", "StatefulSet", "DaemonSet"}
workload_kinds = long_running | {"Job"}
bad = []
checked_workloads = set()
checked_containers = 0

for filename in files:
    with open(filename, encoding="utf-8") as f:
        documents = yaml.safe_load_all(f)

        for doc in documents:
            if not doc or doc.get("kind") not in workload_kinds:
                continue

            kind = doc["kind"]
            name = doc.get("metadata", {}).get("name", "<unnamed>")
            workload = f"{filename}:{kind}/{name}"
            pod_spec = doc.get("spec", {}).get("template", {}).get("spec")

            if not pod_spec:
                bad.append(f"{workload}: missing pod template spec")
                continue

            checked_workloads.add(f"{kind}/{name}")
            pod_security = pod_spec.get("securityContext", {})

            for field in ("containers", "initContainers"):
                for container in pod_spec.get(field, []):
                    checked_containers += 1
                    cname = container.get("name", "<unnamed>")
                    ref = f"{workload}/{field}:{cname}"
                    container_security = container.get("securityContext", {})
                    effective = {**pod_security, **container_security}

                    # For a specified UID, explicitly require a nonzero UID.
                    uid = effective.get("runAsUser")
                    is_nonroot = (
                        uid > 0
                        if isinstance(uid, int) and not isinstance(uid, bool)
                        else effective.get("runAsNonRoot") is True
                    )
                    if not is_nonroot:
                        bad.append(f"{ref}: non-root execution not enforced")

                    if effective.get("allowPrivilegeEscalation") is not False:
                        bad.append(f"{ref}: allowPrivilegeEscalation must be false")

                    dropped = effective.get("capabilities", {}).get("drop", [])
                    if "ALL" not in dropped:
                        bad.append(f"{ref}: must drop ALL capabilities")

                    resources = container.get("resources", {})
                    if not resources.get("requests"):
                        bad.append(f"{ref}: missing resource requests")
                    if not resources.get("limits"):
                        bad.append(f"{ref}: missing resource limits")

                    # Jobs are finite tasks and are not required to have probes.
                    # Long-running containers must define readiness and liveness.
                    if field == "containers" and kind in long_running:
                        for probe in ("readinessProbe", "livenessProbe"):
                            if probe not in container:
                                bad.append(f"{ref}: missing {probe}")

if bad:
    print("CHART POLICY VIOLATIONS:")
    for problem in sorted(set(bad)):
        print(" -", problem)
    sys.exit(1)

print(
    f"chart policy ok: {len(checked_workloads)} unique workloads, "
    f"{checked_containers} containers/init containers checked across {len(files)} rendered charts"
)
PY
