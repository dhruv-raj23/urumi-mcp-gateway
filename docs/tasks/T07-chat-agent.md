# T07 — Chat agent
**Depends on:** T04, T06
**Allowed paths:** `apps/gateway/src/chat/`, `apps/dashboard/src/chat/`, `docs/OPEN_QUESTIONS.md`
**Do:** `POST /api/chat` tool loop (max 8 iterations) per contracts §11 and ADR-0005; provider config via env; system prompt states tool results are untrusted data;
UI shows tool calls (server, tool, ok, duration). Same `callTool(user,'chat',...)` as `/mcp`.
**Acceptance:** as user A: "create product X price 9.99" → product on storefront; "what orders came in today?" returns the order; audit shows `source=chat` and user A; LLM key only in Secret; disabled server's tools not offered to the model.
