#!/usr/bin/env bash
# Ensures the guardrail files that keep agents on-rails still exist.
set -euo pipefail
cd "$(dirname "$0")/.."
REQ="AGENTS.md GEMINI.md CLAUDE.md docs/00-assignment.md docs/01-requirements-traceability.md docs/02-architecture.md
docs/03-contracts.md docs/04-threat-model.md docs/05-design-and-tradeoffs.md docs/06-demo-script.md docs/07-production.md
docs/PROGRESS.md docs/OPEN_QUESTIONS.md docs/DEPENDENCIES.md docs/rules/security.md docs/rules/k8s-helm.md docs/rules/mcp.md
docs/rules/testing-and-style.md .agent/rules/00-read-agents-md.md charts/urumi/Chart.yaml charts/urumi/values.yaml
charts/urumi/values-local.yaml charts/urumi/values-prod.yaml .env.example Makefile"
miss=0; for f in $REQ; do [[ -f "$f" ]] || { echo "MISSING: $f"; miss=1; }; done
for a in gateway woo-mcp mcp-time mcp-notes dashboard; do [[ -d apps/$a ]] || { echo "MISSING app: $a"; miss=1; }; done
ls docs/tasks/T*.md >/dev/null 2>&1 || { echo "MISSING task cards"; miss=1; }
# brief must stay untouched if a baseline hash exists
if [[ -f docs/.assignment.sha256 ]]; then sha256sum -c docs/.assignment.sha256 >/dev/null || { echo "docs/00-assignment.md was modified!"; miss=1; }; fi
[[ $miss -eq 0 ]] && echo "scaffold ok" || exit 1
