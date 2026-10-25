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

Server registration is restricted to administrators. URL validation requires
HTTP(S) and rejects embedded URL user-info. Upstream credentials are stored
encrypted and are not returned by server-management APIs. Discovery and
calls use timeouts; an unavailable upstream can be reported without
necessarily taking down independent upstreams.

**SSRF destination filtering is not comprehensively implemented.** The
gateway does not comprehensively block loopback, cluster-internal, private,
link-local or cloud-metadata destinations. Internal hosts are allowed for
the first-party MCP services. An admin who registers an attacker-controlled
endpoint may cause the gateway to send its configured credential there.
Reachable internal destinations may also create SSRF risk.

NetworkPolicies reduce allowed traffic paths but do not eliminate this
risk. Current policies allow broad TCP 443 egress for required external
services, so they are not a complete SSRF or egress defense.

Before arbitrary upstream URLs are trusted, implement and test destination
allowlisting, private/link-local/metadata address blocking, redirect and DNS
revalidation, and restrictive egress rules. These are future hardening tasks,
not implemented protections. See ADR-0012.

## 6. Operational risks

- Revoke any exposed API key immediately; never show full keys, passwords or
  credential-bearing URLs in source control, logs or video.
- Rotating the credential-encryption key requires a plan for existing
  ciphertext; otherwise stored upstream credentials may become unreadable.
- Persistent volumes are not backups. Test restore procedures for MongoDB,
  MariaDB and WordPress content.
- Local k3d acceptance does not prove public image availability, production
  DNS/TLS, or a successful VPS deployment.
