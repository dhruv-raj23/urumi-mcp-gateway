# 03 — Contracts (LOCKED)

Anything here is a contract. Do not rename, add or remove without a new ADR (`docs/adr/`).
If something you need is missing, use the stop-and-ask protocol in `AGENTS.md`.

## 1. Cluster layout
| Thing | Value |
|---|---|
| Namespace | `urumi` (single namespace for the core; bonus would add per-store namespaces) |
| Helm release name | `urumi` |
| Chart | `charts/urumi` (one chart, one template file group per component) |
| Local cluster | k3d cluster `urumi`, load balancer `80:80@loadbalancer`, ingress = Traefik (k3d default) |
| Local hosts | `store.localhost` (WordPress), `app.localhost` (dashboard + `/api` + `/mcp`) |
| Prod hosts | `store.<DOMAIN>`, `app.<DOMAIN>` (set in `values-prod.yaml`) |

## 2. Components, services, ports
| Component | K8s Service (ClusterIP) | Port | Public? |
|---|---|---|---|
| wordpress | `wordpress` | 80 | YES via Ingress `store.*` |
| mariadb | `mariadb` | 3306 | no |
| mongo | `mongo` | 27017 | no |
| woo-mcp | `woo-mcp` | 3001 | **no** |
| mcp-time | `mcp-time` | 3002 | **no** |
| mcp-notes | `mcp-notes` | 3003 | **no** |
| gateway | `gateway` | 3000 | YES via Ingress `app.*` paths `/api`, `/mcp` |
| dashboard | `dashboard` | 8080 | YES via Ingress `app.*` path `/` |

Upstream MCP endpoint path on every upstream: `POST /mcp` (Streamable HTTP). Every app exposes `GET /healthz` → `200 {"status":"ok"}`.
Upstream URL stored in the gateway DB, e.g. `http://woo-mcp.urumi.svc.cluster.local:3001/mcp`.

## 3. Kubernetes Secrets (created by `scripts/create-secrets.sh`, never by Helm values)
| Secret | Keys |
|---|---|
| `urumi-mongo` | `MONGO_INITDB_ROOT_PASSWORD`, `MONGO_URI` |
| `urumi-mariadb` | `MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD` |
| `urumi-wordpress` | `WORDPRESS_ADMIN_PASSWORD` |
| `urumi-woo-api` | `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET` (pre-generated, seeded into WooCommerce by the init job — see ADR-0006) |
| `urumi-woo-mcp` | `UPSTREAM_AUTH_TOKEN` (shared secret the gateway sends to woo-mcp) |
| `urumi-gateway` | `CREDENTIAL_ENCRYPTION_KEY` (32 bytes, base64), `SESSION_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `LLM_API_KEY` |

Charts reference Secrets by name (`existingSecret`). Chart values contain **no** secret values.

## 4. Environment variables
**gateway:** `PORT=3000`, `MONGO_URI`, `CREDENTIAL_ENCRYPTION_KEY`, `SESSION_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`,
`UPSTREAM_LIST_TIMEOUT_MS=5000`, `UPSTREAM_CALL_TIMEOUT_MS=30000`, `HEALTH_CHECK_INTERVAL_MS=15000`,
`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `COOKIE_SECURE` (`false` local, `true` prod), `PUBLIC_BASE_URL`.
**woo-mcp:** `PORT=3001`, `WC_BASE_URL` (in-cluster WordPress URL), `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`, `UPSTREAM_AUTH_TOKEN`.
**mcp-time / mcp-notes:** `PORT`, `UPSTREAM_AUTH_TOKEN` (optional bearer check).
**dashboard:** build-time only; calls same-origin `/api`.

## 5. MCP tool naming and aggregation
- Gateway-exposed tool name: **`<serverSlug>__<upstreamToolName>`** (double underscore).
- `serverSlug`: regex `^[a-z0-9][a-z0-9-]{1,23}$`, unique, **immutable** after creation.
- Max exposed name length 64 chars. Tools exceeding it are skipped and flagged in the dashboard (`warning` on that server).
- The first-party servers use slugs: `woo` (WooCommerce), `time`, `notes`.
- Upstream tool names (woo-mcp): `list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`.
- mcp-time tools: `get_current_time`, `convert_timezone`, `echo`. mcp-notes tools: `add_note`, `list_notes`, `echo`.
  (`echo` exists on BOTH on purpose, to demonstrate collision handling → `time__echo`, `notes__echo`.)
- Descriptions pass through unchanged but prefixed with `[<slug>] ` so models and humans see the origin.
- `tools/list` = union over enabled servers with status Connected, fetched in parallel with per-server timeout
  (`UPSTREAM_LIST_TIMEOUT_MS`); failed servers are omitted (never fail the whole call); last good list may be cached ≤ 60s.
- `tools/call` strips the prefix, routes to the owning server, enforces `UPSTREAM_CALL_TIMEOUT_MS`,
  returns an MCP tool result with `isError: true` and a clear message on failure/timeout.
- Unknown / disabled / unreachable server → `isError: true` ("server 'x' is unavailable"). Never throw protocol-level errors for these.

## 6. Gateway client-facing MCP endpoint
- `POST {PUBLIC_BASE_URL}/mcp` (Ingress path `/mcp`), **stateless** Streamable HTTP (new server instance per request, no session store).
- Auth: `Authorization: Bearer <apiKey>`. Missing/invalid/revoked → HTTP 401 JSON-RPC-style error. Never forward this header upstream.
- Upstream auth (per server, optional): `authType` = `none` | `bearer` | `header`; credential is sent as `Authorization: Bearer <cred>` or `<headerName>: <cred>`.

## 7. API keys
- Format: `urumi_<prefix8>_<secret43>` where `prefix8` = 8 random chars `[a-z0-9]`, `secret43` = base64url of 32 random bytes.
- Stored: `prefix` (plain, for lookup/display) + `hash` = SHA-256 hex of the full key. Constant-time compare. Full key shown ONCE at creation.
- Revocation sets `revokedAt`; the very next request is rejected (no caching longer than 0s on revocation).
- A user may have multiple keys. Members manage their own keys; admins can revoke anyone's.

## 8. Dashboard auth
- Email + password (bcrypt or argon2) → signed httpOnly, SameSite=Lax session cookie (`SESSION_SECRET`).
- First admin bootstrapped on gateway startup from `BOOTSTRAP_ADMIN_EMAIL/PASSWORD` if no users exist.
- Admin invites a member: creates user + one-time invite token (shown once); member sets password via `/invite/<token>`.
- Roles: `admin`, `member`. Admin: servers, members, all keys, audit log (all). Member: own keys, tools, chat, own audit entries.

## 9. MongoDB (database `urumi`)
| Collection | Fields |
|---|---|
| `users` | `_id`, `email` (unique), `passwordHash`, `role`, `status` (`invited`\|`active`\|`disabled`), `inviteTokenHash?`, `createdAt` |
| `apikeys` | `_id`, `userId`, `name`, `prefix` (unique), `hash`, `createdAt`, `lastUsedAt?`, `revokedAt?` |
| `servers` | `_id`, `slug` (unique), `name`, `url`, `authType`, `headerName?`, `credentialEnc?` (AES-256-GCM: iv+tag+ciphertext, base64), `enabled`, `status` (`connected`\|`unreachable`\|`disabled`), `statusReason?`, `lastCheckedAt?`, `createdAt` |
| `auditlogs` | `_id`, `ts`, `userId`, `userEmail`, `source` (`mcp`\|`chat`), `serverSlug`, `toolName`, `durationMs`, `outcome` (`success`\|`error`\|`timeout`\|`denied`), `errorMessage?` (≤ 300 chars, no secrets), `argsHash` |
Tool arguments are NOT stored in full (only `argsHash`), to avoid leaking customer data into logs.

## 10. REST API (gateway, prefix `/api`, JSON, cookie session unless noted)
```
POST   /api/auth/login | /api/auth/logout | GET /api/auth/me | POST /api/auth/accept-invite
GET    /api/servers                       (any user: slug,name,status,statusReason,toolCount,tools[])  — never credentials
POST   /api/servers          (admin)      PATCH /api/servers/:id (admin)   DELETE /api/servers/:id (admin)
POST   /api/servers/:id/refresh (admin)   re-check health + tools now
GET    /api/users (admin)  POST /api/users/invite (admin)  PATCH /api/users/:id (admin)
GET    /api/keys (own; admin may pass ?userId=)   POST /api/keys   DELETE /api/keys/:id (revoke)
GET    /api/audit?limit&cursor&userId&server&outcome  (admin: all, member: own)
POST   /api/chat  { messages:[...] } → { reply, toolCalls:[{server,tool,ok,durationMs}] }
GET    /healthz (no auth)
```
Errors: `{ "error": { "code": "...", "message": "..." } }` with correct HTTP status. Credentials are write-only fields.

## 11. Chat agent
- Provider-agnostic via OpenAI-compatible Chat Completions with tools (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`).
- Tool list comes from the same aggregator function as `/mcp`, for the logged-in user. Calls go through the same
  `callTool(user, source='chat', ...)` function → audited under that user. Max 8 tool-loop iterations. Tool results are
  treated as untrusted data (see `docs/rules/mcp.md`).

## 12. WooCommerce
- Image: official `wordpress` + `mariadb` images (or equivalents); WooCommerce installed/activated by the init Job using WP-CLI.
- Payment: Cash on Delivery enabled. Currency set once in init. Store URL local `http://store.localhost`.
- woo-mcp talks to WordPress via **WooCommerce REST API v3** (`/wp-json/wc/v3/...`) — see ADR-0003.
- `update_order_status` accepts only: `pending`, `processing`, `on-hold`, `completed`, `cancelled`, `refunded`, `failed`.
- `list_orders` supports `after`/`before` ISO dates (so "orders today" works), `status`, `per_page` (max 50).

## 13. Helm values keys (top level of `charts/urumi/values.yaml`)
`global`, `ingress`, `mongo`, `mariadb`, `wordpress`, `wooMcp`, `gateway`, `dashboard`, `mcpTime`, `mcpNotes`, `networkPolicy`.
Each workload block has: `image.{repository,tag,pullPolicy}`, `resources.{requests,limits}`, `replicas`, `existingSecret` (where relevant), `persistence.{enabled,size,storageClass}` (stateful ones).
