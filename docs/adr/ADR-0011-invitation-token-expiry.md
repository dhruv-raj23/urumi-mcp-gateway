# ADR-0011: One-time invitation tokens with 24-hour expiry

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** T03 gateway invitation creation and acceptance

## Decision

- Invitation tokens contain 32 cryptographically random bytes encoded as base64url (43 characters).
- The gateway returns the plaintext token only in the invite response, with `Cache-Control: no-store`; request/response bodies must not be logged.
- MongoDB stores only the SHA-256 token hash and `inviteExpiresAt`. A sparse index on `users.inviteTokenHash` supports lookup without indexing users that do not have an invitation.
- Invitation lifetime is `INVITATION_TTL_MS = 24 * 60 * 60 * 1000`, declared once as a code constant.
- Re-inviting a user whose status is `invited` rotates both the hash and expiry, invalidating the previous link. An `active` email returns 409. A disabled user is rejected with 409 pending the explicit policy question in `docs/OPEN_QUESTIONS.md`.
- Acceptance requires status `invited`, a present expiry strictly later than the current time, and a matching hash. After password hashing, a single conditional MongoDB update checks `_id`, status, token hash, and expiry; it sets the new bcrypt password hash and `active` status while clearing both invitation fields. This allows exactly one of concurrent attempts to succeed.
- Unknown, expired, already-used, disabled, and superseded tokens that pass body validation all receive the same HTTP 400 response: `invalid_invitation` / `Invitation is invalid or expired`.
- Acceptance passwords have a minimum of 12 Unicode characters and maximum of 72 UTF-8 bytes, matching bcrypt's effective input limit. Both the invitation and acceptance JSON schemas reject unknown fields.

## Consequences

Invitation links in email or chat history stop working after 24 hours or after successful acceptance/re-invitation. This requires the optional `inviteExpiresAt` field in the user schema and contract. No new dependency is required.
