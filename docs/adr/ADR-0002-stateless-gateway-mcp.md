# ADR-0002: Stateless Streamable HTTP on the gateway client side
Status: Accepted (2026-10-15)

## Context
Gateway must work behind Ingress and ideally with >1 replica. MCP sessions add sticky-state complexity.

## Decision
Create a fresh MCP server instance per `POST /mcp` request; no session store. Auth on every request via API key.

## Consequences
Simple and horizontally scalable. No server-initiated notifications/streams to clients; acceptable.
