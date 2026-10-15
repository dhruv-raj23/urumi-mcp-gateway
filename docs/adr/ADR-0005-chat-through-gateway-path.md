# ADR-0005: Chat agent uses the gateway's own call path as the user
Status: Accepted (2026-10-15)

## Context
Brief: chat must reach upstreams only through the gateway and be audited as the logged-in user.

## Decision
Chat service calls the same `listTools(user)` / `callTool(user, source='chat')` functions used by `/mcp`, in-process, with the session user. LLM via OpenAI-compatible API.

## Consequences
Same enforcement/audit path for both. No internal self-HTTP hop or minted tokens needed.
