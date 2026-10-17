# ADR-0003: woo-mcp talks to WooCommerce via REST API v3

Status: Accepted (2026-10-15)

## Context

Options: REST API, WP-CLI via exec, direct DB. Need isolation, network-only
access, and standard semantics.

WooCommerce REST API consumer-key authentication over in-cluster HTTP
required verification because WooCommerce normally expects HTTPS for
Basic authentication.

## Decision

Use WooCommerce REST API v3 with a dedicated consumer key and secret held
only by woo-mcp.

For in-cluster requests, send `X-Forwarded-Proto: https`. WordPress is
configured to set `$_SERVER['HTTPS'] = 'on'` when that header's first
value is `https`, allowing WooCommerce to accept consumer-key authentication.

## Verification

T01 verification used an in-cluster curl Pod and the credentials from the
`urumi-woo-api` Kubernetes Secret. A GET request to
`http://wordpress/wp-json/wc/v3/products`, with
`X-Forwarded-Proto: https`, returned HTTP 200 and `[]`.

This confirms that authentication succeeded. The empty array indicates
that the endpoint returned no products at the time of the test.

## Security considerations

The request travels over HTTP inside the cluster; the forwarded-protocol
header does not encrypt that connection. Only trusted callers should be
allowed to reach the WordPress Service, and the header must not be trusted
from arbitrary clients. Enforce appropriate network restrictions as part
of the planned network-policy work.

## Consequences

Clean network boundary, no exec into pods, and no database coupling.
The integration depends on WooCommerce REST API availability and the
correct handling of the forwarded-protocol header.
