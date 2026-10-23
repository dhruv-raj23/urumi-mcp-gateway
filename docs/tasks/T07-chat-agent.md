# T07 — Chat agent
**Depends on:** T04, T06
**Allowed paths:** `apps/gateway/src/chat/`, `apps/dashboard/src/chat/`, `apps/gateway/src/http/app.ts` (wiring-only), `apps/dashboard/src/main.tsx` (wiring-only), `apps/gateway/tests/`, `apps/dashboard/src/__tests__/`, `docs/OPEN_QUESTIONS.md`, `docs/adr/ADR-0015-llm-provider.md`, `docs/04-threat-model.md`, `docs/tasks/T07-chat-agent.md`.

**Approved scope extension (owner, 22 Oct 2026):** `apps/gateway/src/http/app.ts` and `apps/dashboard/src/main.tsx` are wiring-only; all chat logic stays in the dedicated `chat/` directories, and integration tests stay in the two approved test directories. No new dependencies.
**Do:** `POST /api/chat` tool loop (max 8 iterations) per contracts §11 and ADR-0005; provider config via env; system prompt states tool results are untrusted data;
UI shows tool calls (server, tool, ok, duration). Same `callTool(user,'chat',...)` as `/mcp`.
**Acceptance:** as user A: "create product X price 9.99" → product on storefront; "what orders came in today?" returns the order; audit shows `source=chat` and user A; LLM key only in Secret; disabled server's tools not offered to the model.

**Approved scope extension (owner, 23 Oct 2026):**
`docs/03-contracts.md`, `charts/urumi/values.yaml`, and
`charts/urumi/templates/gateway-deployment.yaml` may be modified
solely to document and configure the ordered `LLM_MODELS` fallback
chain. No new dependencies, secret keys, or cross-provider routing
are included in this extension.
