#!/usr/bin/env bash
# Cheap secret scan over source/chart/scripts. Fails on likely hardcoded secrets.
set -uo pipefail
cd "$(dirname "$0")/.."
PATTERN='(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(password|secret|token|api[_-]?key)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9+/=_-]{12,}["'"'"'])'
HITS=$(grep -rEn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude=check-secrets.sh \
  -e "$PATTERN" apps charts scripts .github 2>/dev/null || true)
if [[ -n "$HITS" ]]; then echo "POSSIBLE HARDCODED SECRETS:"; echo "$HITS"; exit 1; fi
if git ls-files --error-unmatch .env >/dev/null 2>&1; then echo ".env is tracked!"; exit 1; fi
echo "secret scan ok"
