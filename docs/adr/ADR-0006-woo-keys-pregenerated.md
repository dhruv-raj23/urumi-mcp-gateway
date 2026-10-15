# ADR-0006: WooCommerce API keys pre-generated and seeded by init Job
Status: Accepted (2026-10-15)

## Context
woo-mcp needs a consumer key/secret. Generating inside WP and copying out to a Secret would require the init Job to have K8s API RBAC.

## Decision
`scripts/create-secrets.sh` generates `WC_CONSUMER_KEY/SECRET` into Secret `urumi-woo-api`; the WP-CLI init Job inserts the matching row into WooCommerce's API keys table. Exact mechanism verified in T01.

## Consequences
No K8s API permissions for the init Job. Seeding code depends on WooCommerce internals; verify against the installed version.
