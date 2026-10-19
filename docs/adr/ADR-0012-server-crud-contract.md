# ADR-0012: Server CRUD validation and response contract

- **Status:** Accepted
- **Date:** 2026-10-19
- **Context:** T03 requires admin-managed upstream MCP server registrations. Stored upstream credentials must remain backend-only, and PATCH must not leave a partially configured authentication state.

## Decision

- `GET /api/servers` is available to any authenticated user. Create, PATCH, DELETE, and refresh are admin-only.
- POST accepts strict JSON fields `slug`, `name`, `url`, `authType`, optional `headerName`, optional write-only `credential`, and optional `enabled` (default `true`). Slug is immutable after creation. Duplicate slugs return `409 Conflict`; unknown fields return `400`.
- PATCH accepts only `name`, `url`, `authType`, `headerName`, `credential`, and `enabled`. `slug`, `credentialEnc`, and all unknown fields return `400`. Validate the resulting server state, not only the supplied fields. Omitting `credential` preserves an existing encrypted credential. A transition from `authType: "none"` to `"bearer"` or `"header"` must include a credential in the same request. Setting `authType: "none"` clears both `credentialEnc` and `headerName`. `headerName` is retained only for `authType: "header"`.
- `authType` is `none`, `bearer`, or `header`. For `none`, reject credentials and header names. `bearer` requires a credential and must not have a header name. `header` requires both a credential and a header name.
- Accept only `http` and `https` URLs, with a maximum length of 2048 characters. Reject embedded username/password URL user-info. Do not reject cluster-internal hostnames; upstreams may intentionally be cluster-internal. SSRF destination filtering is a documented hardening gap/stretch item.
- Credential length is at most 4096 characters; reject carriage return or line feed. Encrypt accepted credentials at rest. Header names must use HTTP token syntax and are case-insensitively rejected when equal to `host`, `content-length`, `content-type`, `accept`, `connection`, or `transfer-encoding`.
- No response may contain `credential` or `credentialEnc`. Include `hasCredential: boolean` to tell the dashboard whether a credential is configured. New enabled servers start with `status: "unreachable"`, `statusReason: "not checked yet"`, `toolCount: 0`, and `tools: []`; disabled servers report `status: "disabled"`. T04's health/tool discovery replaces the initial status.
- The API uses the common error envelope and never places raw credentials in error messages or audit rows.

## Consequences

The dashboard can show whether a credential is set without retrieving it. The resulting-state checks prevent inconsistent auth configurations. SSRF protection for admin-supplied URLs remains a known gap and must not be described as implemented.
