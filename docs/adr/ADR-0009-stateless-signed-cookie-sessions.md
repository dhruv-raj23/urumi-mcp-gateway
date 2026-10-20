# ADR-0009: Stateless signed-cookie sessions (8h)

Status: Accepted (2026-10-18)

## Context

Contract §8 requires email/password authentication and a signed HTTP-only,
SameSite=Lax session cookie using `SESSION_SECRET`. The contract does not
specify the cookie name, payload, expiry, or logout behavior.

The brief requires API keys to be revocable, but does not require immediate
revocation of individual browser sessions.

## Decision

- Name the browser cookie `urumi_session`.
- Encode a payload containing `uid` (user ID) and `exp` (Unix expiry time),
  and sign it with HMAC-SHA256 using `SESSION_SECRET`.
- Set an eight-hour expiry. Validate the signature using
  `crypto.timingSafeEqual` after verifying the signature lengths match.
- Validate the expiry and re-fetch the user on every authenticated request.
  The request is rejected unless the user exists and their status is `active`.
- Set `HttpOnly`, `SameSite=Lax`, and `Path=/`. Set `Secure` only when
  `COOKIE_SECURE=true`; local and production behavior comes from configuration.
- Accept state-changing request bodies only as `application/json`.
- Logout clears the browser cookie. It does not individually revoke a copied
  cookie; such a cookie remains valid until expiry if its user remains active.

## Consequences and trade-offs

This design avoids a server-side session store and is consistent with the
brief's stated requirements. Account disablement immediately blocks subsequent
requests because user status is checked on every request. A copied cookie may
survive a plain browser logout until its eight-hour expiry, which is an accepted
limitation rather than an unintentional property.

If immediate session revocation becomes necessary, a possible upgrade is to
add a `sessionVersion` field to the user document, include that version in the
signed cookie, and increment it on logout. This changes the §9 user schema and
must be proposed through a separate ADR before implementation.
