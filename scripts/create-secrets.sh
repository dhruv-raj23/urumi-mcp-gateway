#!/usr/bin/env bash
# Creates all Kubernetes Secrets from contracts §3. Idempotent: existing secrets are kept unless FORCE=1.
# Required env: LLM_API_KEY, BOOTSTRAP_ADMIN_PASSWORD. Optional: BOOTSTRAP_ADMIN_EMAIL (default admin@example.com).
# NEVER prints secret values. NEVER commit generated values.
set -euo pipefail
NS="${NAMESPACE:-urumi}"
: "${LLM_API_KEY:?set LLM_API_KEY in your shell (not in git)}"
: "${BOOTSTRAP_ADMIN_PASSWORD:?set BOOTSTRAP_ADMIN_PASSWORD in your shell}"
ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@example.com}"

kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
hex() { openssl rand -hex "$1"; }

create() { # name, then key=value args
  local name="$1"; shift
  if [[ "${FORCE:-0}" != "1" ]] && kubectl -n "$NS" get secret "$name" >/dev/null 2>&1; then
    echo "exists: $name (use FORCE=1 to recreate)"; return
  fi
  local args=()
  for kv in "$@"; do args+=(--from-literal="$kv"); done
  kubectl -n "$NS" create secret generic "$name" "${args[@]}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "created: $name"
}

MONGO_PW="$(hex 16)"
create urumi-mongo "MONGO_INITDB_ROOT_PASSWORD=${MONGO_PW}" \
  "MONGO_URI=mongodb://root:${MONGO_PW}@mongo:27017/urumi?authSource=admin"
create urumi-mariadb "MARIADB_ROOT_PASSWORD=$(hex 16)" "MARIADB_PASSWORD=$(hex 16)"
create urumi-wordpress "WORDPRESS_ADMIN_PASSWORD=$(hex 12)"
create urumi-woo-api "WC_CONSUMER_KEY=ck_$(hex 20)" "WC_CONSUMER_SECRET=cs_$(hex 20)"
create urumi-woo-mcp "UPSTREAM_AUTH_TOKEN=$(hex 24)"
create urumi-gateway \
  "CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)" \
  "SESSION_SECRET=$(hex 32)" \
  "BOOTSTRAP_ADMIN_EMAIL=${ADMIN_EMAIL}" \
  "BOOTSTRAP_ADMIN_PASSWORD=${BOOTSTRAP_ADMIN_PASSWORD}" \
  "LLM_API_KEY=${LLM_API_KEY}"
echo "done. list with: kubectl -n $NS get secrets"
