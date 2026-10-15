# ADR-0001: One Helm chart for everything
Status: Accepted (2026-10-15)

## Context
Brief mandates Helm, same charts local and VPS, differences only via values. Rollback story must be simple.

## Decision
One chart `charts/urumi` with a template group per component and toggles in values. Local/prod differ only in `values-local.yaml` / `values-prod.yaml`.

## Consequences
Single `helm upgrade/rollback` covers all components. Less modular than per-component charts; acceptable for scope.
