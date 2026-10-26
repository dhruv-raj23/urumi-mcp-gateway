# OPEN QUESTIONS (agents append; owner resolves)
Format: `- [ ] (Txx) question — proposed default — status`

- [x] (T01) WooCommerce REST key auth over plain HTTP inside the cluster — resolved using option (b): send `X-Forwarded-Proto: https`; WordPress maps it to HTTPS for WooCommerce authentication. Verified with an in-cluster request to `/wp-json/wc/v3/products`: HTTP 200, response `[]`. See ADR-0003. The connection remains HTTP, so only trusted callers may reach the WordPress Service; network restrictions are still required.
- [x] (T07) LLM provider/model — resolved 22 Oct 2026 via ADR-0015: Gemini OpenAI-compatible Chat Completions, model `gemini-3.8-flash`, base URL `https://generativelanguage.googleapis.com/v1beta/openai/`. Verify account quotas in AI Studio before live use.
- [x] (T01) WordPress database name and application DB username — decision: database `wordpress`, user `wordpress`, password from `urumi-mariadb` key `MARIADB_PASSWORD` — resolved by ADR-0008.
- [x] (T01) WooCommerce store currency — decision: `INR` — resolved by ADR-0008.
- [x] (T01) WordPress internal Apache container port — decision: Apache listens on unprivileged port `8080`, named `http`; Service port remains `80` with `targetPort: http`, and Ingress routes to Service port `80`. Probes target the container port using `/wp-login.php` or TCP as appropriate — resolved by ADR-0008.
- [x] (T08) WordPress NetworkPolicy port — resolved: NetworkPolicy rules target WordPress Pod port `8080`; the Service exposes port `80` and forwards to the named HTTP target port. Evidence: `charts/urumi/templates/networkpolicy.yaml` and `charts/urumi/templates/wordpress.yaml`.

## T03 authentication decisions — 18 Oct 2026

### 1. Session cookie format, expiry, and logout behavior

**Contract:** A signed HTTP-only, SameSite=Lax session cookie using SESSION_SECRET; Secure is enabled when COOKIE_SECURE=true.

**Missing:** Cookie name, signed payload format, expiry, and whether logout must invalidate a copied/stolen cookie immediately.

**Proposed default:** Cookie name `urumi_session`; HMAC-SHA256 signed payload containing user ID and expiry; eight-hour lifetime; re-check the user's active status in MongoDB on every authenticated request; logout clears the browser cookie. A stateless cookie cannot revoke a copied cookie immediately before its expiry. Immediate revocation would require a server-side session or another persisted revocation mechanism.

**Decision: Resolved by ADR-0009.** Use the stateless signed-cookie approach with an eight-hour lifetime; immediate per-session revocation is not required by the brief.

### 2. Invitation acceptance payload and token lifetime

**Contract:** POST /api/auth/accept-invite; the users collection has inviteTokenHash, and the invitation is one-time use.

**Missing:** Request body fields, token format, and expiry policy.

**Proposed default:** JSON body `{ "token": "...", "password": "..." }`; generate a cryptographically random token, return it only once to the inviting admin, store only its SHA-256 hash, and clear the stored hash after successful acceptance. The current schema has no invitation-expiry field, so expiration needs a decision before implementation.

**Decision: Resolved by ADR-0011.** Use a strict `{ "token": string, "password": string }` acceptance body; generate 32 random bytes encoded as base64url; store only the SHA-256 hash; expire invitations after 24 hours using `inviteExpiresAt`; generic 400 for unknown/expired/used tokens; one-time atomic activation. See ADR-0011.

### 3. Server create/patch payload

**Contract:** Server fields include slug, name, url, authType, optional headerName and credentialEnc; authType is `none`, `bearer`, or `header`. Credentials are write-only.

**Missing:** Exact accepted request fields, enabled default, and PATCH semantics.

**Proposed default:** POST accepts `slug`, `name`, `url`, `authType`, optional `headerName`, and write-only `credential`; `enabled` defaults to true. PATCH accepts only mutable fields from that set plus `enabled`; unknown fields are rejected. For `authType=none`, reject credentials; for `bearer` or `header`, require a credential; for `header`, require a valid `headerName`. Never accept `credentialEnc` from clients.

**Decision: Resolved by ADR-0012 (19 Oct 2026).** Apply immutable slug, strict create/PATCH schemas, resulting-state validation, URL/header/credential constraints, `hasCredential` redaction-safe responses, duplicate-slug 409, and the initial unchecked status convention.

### 4. Audit pagination

**Contract:** `GET /api/audit?limit&cursor&userId&server&outcome`; members see their own entries and admins may query all.

**Missing:** Default/max limit and cursor encoding.

**Proposed default:** Default limit 50, maximum 100; opaque cursor encoding the last row's timestamp and ObjectId, with stable descending pagination by `(ts, _id)`.

**Decision: Resolved by ADR-0013 (19 Oct 2026).** Default limit 50, strict range 1–100, HMAC-SHA256-signed base64url `{ts,id}` cursor using `SESSION_SECRET`, stable descending pagination, server-enforced member scope, filter validation, and append-only audit rows.

- [x] (T03) `POST /api/keys` request/response shape — approved: strict JSON `{ "name": string }`, trimmed length 1–100; reject unknown fields; create only for the authenticated user; return HTTP 201 with separate `key` and `apiKey` metadata and `Cache-Control: no-store`. See the T03 API-key contract clarification and ADR-0010.\n
- [x] (T03) Invitation token expiry and acceptance security — resolved: 32-byte random token, SHA-256 hash, 24-hour expiry, one-time atomic acceptance, generic invalid-token response — see ADR-0011.


- [x] (T03) Disabled-user invitation policy — return HTTP 409; reactivation must be a separate explicit account-management action. Only users still in `invited` status may be re-invited; active users also return HTTP 409 — resolved by owner decision on 19 Oct 2026.

- [x] (T04) MCP route and dependency scope — approved by the owner on 20 Oct 2026: T04 may update `apps/gateway/src/http/app.ts`, `apps/gateway/package.json`, `apps/gateway/package-lock.json`, and `docs/DEPENDENCIES.md`. Keep MCP implementation logic under `apps/gateway/src/mcp/` and `apps/gateway/src/health/`; tests remain under the gateway test directory. No contract change; follow ADR-0002.

## T06 member-disable endpoint

- [x] **Resolved 21 Oct 2026 via ADR-0014:** strict `{ "status": "disabled" }` request; HTTP 200 public-user response; admin-only; only member accounts can be disabled; active and invited members may transition to disabled; invited tokens are cleared; repeat requests for already-disabled members are idempotent; no reactivation through this endpoint.
- **Implementation:** tracked in `docs/tasks/T06A-member-disable-endpoint.md`.
- **T06 status:** member-disablement implementation and acceptance evidence are tracked in `docs/tasks/T06A-member-disable-endpoint.md`; use that task record rather than this resolved-question log to assess completion.

## T07 scope — chat route and dashboard integration

- [x] **Resolved 22 Oct 2026 by owner approval:** `apps/gateway/src/http/app.ts` and `apps/dashboard/src/main.tsx` may be changed for wiring only. Chat logic stays under `apps/gateway/src/chat/` and `apps/dashboard/src/chat/`; tests stay under `apps/gateway/tests/` and `apps/dashboard/src/__tests__/`. No dependencies may be added.
- [x] **T07 provider resolved 22 Oct 2026 via ADR-0015:** initial provider is Gemini through the OpenAI-compatible Chat Completions endpoint; active quotas must be checked in AI Studio.
