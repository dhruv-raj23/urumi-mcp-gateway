# mcp-notes

Internal MCP upstream on port 3003.

Tools:
- `add_note`: add a note with text.
- `list_notes`: list recent notes (default limit 20, maximum 100).
- `echo`: return a message unchanged.

Transport: stateless Streamable HTTP at `POST /mcp`.
Health check: `GET /healthz`.
Authentication: optional Bearer token via `UPSTREAM_AUTH_TOKEN`; when unset, the internal service does not require bearer authentication.

## Storage choice

T05 uses an in-memory array capped at 1,000 notes. Notes are shared across requests handled by this process, but **are not durable**: restarting or rescheduling the pod loses its notes. This is intentional for the assignment's lightweight notes-server requirement; a database or PVC would be needed for persistent notes.
