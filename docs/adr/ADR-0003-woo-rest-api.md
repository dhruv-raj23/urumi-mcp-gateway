# ADR-0003: woo-mcp talks to WooCommerce via REST API v3
Status: Accepted (2026-10-15)

## Context
Options: REST API, WP-CLI via exec, direct DB. Need isolation, network-only access, and standard semantics.

## Decision
Use WooCommerce REST v3 with a dedicated consumer key/secret held only by woo-mcp. Auth-over-HTTP issue is tracked in OPEN_QUESTIONS and resolved/recorded here during T01.

## Consequences
Clean network boundary, no exec into pods, no DB coupling. Depends on WooCommerce REST availability.
