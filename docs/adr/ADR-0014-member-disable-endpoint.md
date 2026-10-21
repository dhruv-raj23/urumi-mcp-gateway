# ADR-0014: Admin-only member disable endpoint

- **Status:** Accepted
- **Date:** 2026-10-21
- **Context:** T06 requires administrators to disable team members. The existing contract names `PATCH /api/users/:id`, but does not fully define its request, response, or status transitions.

## Decision

- `PATCH /api/users/:id` requires an authenticated administrator and accepts strict JSON `{ "status": "disabled" }`. Unknown fields and any other status are rejected with HTTP 400.
- A valid target ID is a 24-character hexadecimal MongoDB ObjectId. Malformed IDs return HTTP 400; missing users return HTTP 404.
- Only accounts with role `member` may be disabled by this endpoint. Attempting to disable an administrator returns HTTP 409 with code `user_not_disableable`. This prevents self-disablement through this route and protects the administrator account set from accidental lockout.
- Active and invited member accounts transition to `disabled`. Disabling an invited account also clears `inviteTokenHash` and `inviteExpiresAt`.
- Repeating a disable request for an already-disabled member is idempotent and returns HTTP 200 with the same public user shape.
- A successful response is HTTP 200 with `{ "user": { "id", "email", "role", "status", "createdAt" } }`. Never return password hashes or invitation-token material.
- Apply the status transition atomically using the observed ID, role, and status. If a concurrent change prevents the update, re-read the target and return success only if it is now a disabled member; otherwise return HTTP 409 with code `user_state_conflict`.
- Existing session and API-key authentication must continue to reject disabled accounts. This endpoint does not reactivate accounts. Reactivation requires a separate explicit account-management decision.

## Consequences

Administrators can disable member accounts without adding a schema or dependency. Active sessions and API keys become unusable because authentication checks the current user status. Administrator accounts cannot be disabled through this route.
