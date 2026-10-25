# 04 — Threat model

This document describes the current implementation and its remaining risks.

## 1. Shared upstream credentials

A member's API key authenticates the member to the gateway. The gateway
stores upstream credentials separately, encrypts them in MongoDB, and uses
them when making upstream calls. The client does not need to see those
credentials.

Hiding a credential does not remove its authority. A member can invoke any
tool exposed by an enabled, reachable upstream. For WooCommerce, that
includes listing products and orders, creating products, retrieving orders,
and updating order status. A compromised member account can misuse the
shared tool authority within that exposed surface.

Implemented controls include per-user API keys, key revocation, user-aware
audit records, admin-only server management, encrypted upstream credentials,
internal-only upstream Services, NetworkPolicies, and bounded upstream
timeouts, and fixed role-based tool authorization. Members can only list
and invoke explicitly allowlisted tools; restricted direct calls are denied
before an upstream connection and logged as denied. Admins can use all
otherwise available tools. This policy is not configurable per user, and
comprehensive per-user rate limiting is not implemented. Audit logs help
investigation but do not prevent misuse.

## 2. Why client tokens are not passed upstream

The client API key identifies a user to this gateway. An upstream credential
identifies the gateway/service to an upstream. They represent different
trust boundaries and are not interchangeable.

The gateway validates the client key, retrieves the configured upstream
credential, and sends the upstream's expected authorization header. It does
not forward the client's bearer token as upstream authentication. Revoking
a client key blocks subsequent requests made with that key; it is separate
from rotating an upstream credential.

This separation limits accidental credential propagation, but a compromised
gateway could still access the upstream credentials it needs to operate.

## 3. Untrusted upstream descriptions and results

A malicious upstream can return tool descriptions or results containing
prompt-injection instructions. Tool descriptions are prefixed with the
upstream slug to communicate their origin. The chat tool loop is capped at
eight iterations, and calls use the same user-attributed gateway path.

These measures are not a complete prompt-injection defense. A model may
still be influenced by malicious text and choose an action available through
the exposed tool set. Prefixing a description indicates provenance; it does
not sanitize the description or make its contents trustworthy. The fixed
role-based allowlist limits member tool access, but it does not eliminate
prompt-injection risk. Review new tools before adding them to the allowlist.

Review upstream ownership, code, tool definitions and returned data before
trusting a new server. Limit credential authority and monitor audit events.

## 4. What one team member can do to another

API keys belong to individual users. Members manage their own keys and are
scoped to their own audit entries; administrators have broader user, server,
key and audit visibility. Disabling a member blocks subsequent authenticated
requests. Chat history remains in browser memory and is sent with chat
requests; the gateway does not persist chat transcripts or log full chat
message bodies.

Members can invoke only allowlisted tools, while admins retain access to
otherwise available write tools. Audit logging provides attribution but does
not replace authorization checks or comprehensive rate limiting. The policy
is fixed in code rather than configurable for individual members.

Browser sessions use stateless signed cookies with an eight-hour expiry.
A copied cookie may remain valid until expiry after logout while its user
remains active. Disabling that account blocks subsequent requests, but
immediate individual session revocation is not implemented; see ADR-0009.

## 5. Malicious or compromised upstream registered by an admin

Server registration is restricted to administrators. URL validation rejects
unsupported schemes and embedded URL user-info. External upstreams must use
HTTPS on the default port and a public-looking hostname or public-unicast IP.
Loopback, private, link-local, metadata and other blocked destination classes
are rejected by the destination validator.

The first-party MCP services are a narrow exception: an upstream must match
its expected slug, fully qualified Kubernetes Service hostname, port and
`/mcp` path. Arbitrary internal hostnames are not trusted as first-party
services.

For external hostnames, DNS addresses are validated when the connection is
made. Unsafe answers, including a response containing a mixture of public and
private addresses, are rejected. The connection uses the validated addresses
rather than performing an unchecked second lookup. The safe-fetch path checks
that the requested destination matches the configured upstream and disables
automatic redirect following. These controls reduce DNS-rebinding and
redirect-based SSRF paths; they do not establish that a public server is
trustworthy.

Upstream credentials are stored encrypted and are not returned by
server-management APIs. A malicious public endpoint registered by an
administrator could still receive the gateway's configured upstream
credential. Review upstream ownership, code, tool definitions, returned data
and credential scope before trusting a new server.

NetworkPolicies provide an additional traffic boundary. Broad outbound TCP
443 rules now exclude multiple IPv4 private, loopback, link-local, shared,
documentation, benchmarking and reserved ranges. These rules are not a
hostname allowlist, do not replace application-layer destination validation,
and are not a complete egress defense. The exclusions are IPv4-specific;
IPv6 behavior and enforcement depend on the cluster networking configuration.

The `feat/ssrf-hardening` branch was deployed to the local k3d cluster
in Helm revision 43 using gateway image `urumi/gateway:ssrf-eede0dd`.

Runtime checks confirmed that the trusted WooCommerce URL is accepted, unsafe
test destinations are rejected, and safe-fetch reached WooCommerce MCP. The
GET connectivity probe returned HTTP 405, which confirms an HTTP response but
does not constitute a successful MCP operation.

For the NetworkPolicy negative control, a temporary egress policy allowed
only a test pod to connect to WooCommerce MCP. A positive control confirmed
that the gateway could connect to the same endpoint; the non-gateway test
pod received `ECONNREFUSED`. An immediate refusal does not uniquely
prove a NetworkPolicy drop, so this is an observed negative connection result,
not conclusive proof of CNI enforcement. A CNI-aware enforcement check remains
outstanding. The temporary pod and policy were removed afterward.

All eight application pods were ready after the rollout, and the gateway had
zero restarts in the latest observed pod listing. This is evidence from the
tested local k3d cluster, not a production deployment or proof of complete
IPv4/IPv6 egress enforcement. See ADR-0012.

## 6. Operational risks

- Revoke any exposed API key immediately; never show full keys, passwords or
  credential-bearing URLs in source control, logs or video.
- Rotating the credential-encryption key requires a plan for existing
  ciphertext; otherwise stored upstream credentials may become unreadable.
- Persistent volumes are not backups. Test restore procedures for MongoDB,
  MariaDB and WordPress content.
- Local k3d acceptance does not prove public image availability, production
  DNS/TLS, or a successful VPS deployment.
