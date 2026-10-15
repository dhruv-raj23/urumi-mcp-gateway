# ADR-0007: Secrets created out-of-band, referenced by name
Status: Accepted (2026-10-15)

## Context
Brief forbids hardcoded secrets; Helm values files are committed.

## Decision
Secrets are created by `scripts/create-secrets.sh` (random generation; LLM key from env). Chart only references `existingSecret` names.

## Consequences
Nothing sensitive in git or Helm history. One extra manual step in README.
