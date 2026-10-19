# ADR-0010: API-key creation contract clarification

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

The existing REST contract lists `POST /api/keys` but does not specify the
request validation or one-time-secret response shape. The implementation
needs explicit rules so callers cannot create keys for another user and
the secret is not accidentally cached or returned by list endpoints.

## Decision

- Require a strict JSON body containing only `name`, trimmed to 1–100
  characters. Reject unknown fields with HTTP 400.
- Always associate a new key with the authenticated user, including when
  the caller is an administrator.
- Return HTTP 201 with separate `key` and `apiKey` metadata fields.
  Return the full secret only at creation and include `Cache-Control:
  no-store`; never log response bodies.
- List only `id`, `name`, `prefix`, `createdAt`, `lastUsedAt`, and
  `revokedAt`, never the hash or full secret.
- Revocation sets `revokedAt`, is idempotent, returns 404 when a member
  targets another user's key, and permits administrators to revoke any key.

## Consequences

These details clarify the existing API-key endpoint and MongoDB contract;
they do not add a new endpoint or change the API-key format.
