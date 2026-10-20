# ADR-0013: Audit pagination and query scope

- **Status:** Accepted
- **Date:** 2026-10-19
- **Context:** T03 exposes audit history to admins and members. Pagination must be deterministic when many rows share a timestamp, and query parameters must never let a member escape their own scope.

## Decision

- `GET /api/audit` returns `{ "items": [...], "nextCursor": string | null }`. The endpoint is read-only; no audit update or delete routes are introduced.
- If `limit` is omitted, use 50. If supplied, it must be an integer from 1 through 100; reject malformed, non-integer, lower-than-1, or greater-than-100 values with HTTP 400 rather than clamping.
- Sort newest first by `(ts DESC, _id DESC)`. Fetch `limit + 1` rows to determine whether a next page exists. Return at most `limit` rows and use the last returned row to construct `nextCursor`; return `null` when no additional row exists.
- The cursor format is `<payload>.<signature>`. `payload` is unpadded base64url encoding of compact UTF-8 JSON `{ "ts": "<ISO-8601 timestamp>", "id": "<24-hex ObjectId>" }`. `signature` is unpadded base64url HMAC-SHA256 over the exact ASCII payload segment, keyed by the existing `SESSION_SECRET`. Treat the cursor as opaque. Verify the signature using a timing-safe comparison before trusting the payload; validate canonical base64url encoding, exact payload fields, canonical ISO-8601 timestamp, and ObjectId shape. Malformed, non-canonical, invalid, or tampered cursors return HTTP 400. Rotating `SESSION_SECRET` invalidates outstanding cursors. Continue the query with `ts < cursor.ts OR (ts == cursor.ts AND _id < cursor.id)`.
- Validate `userId` as a 24-hex ObjectId, `server` against the contract's server slug pattern, and `outcome` against `success`, `error`, `timeout`, or `denied`. Malformed filters return HTTP 400.
- Admins may query all rows and use filters. A member's query is always constrained to that member's own `userId`. Supplying a different `userId` returns HTTP 403. A cursor never widens the member's scope.
- Add the compound MongoDB index `{ ts: -1, _id: -1 }` to support stable descending pagination. Existing user/server/outcome filter indexes remain in place.
- Audit rows and their JSON responses never contain raw upstream credentials, API keys, invite tokens, or full tool arguments. Continue storing `argsHash` instead of full arguments and sanitize `errorMessage`.

## Consequences

Stable pagination handles equal timestamps without gaps or duplicates. Server-side scope enforcement remains effective regardless of cursor input. Invalid client parameters fail visibly rather than being silently changed.
