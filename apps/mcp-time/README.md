# mcp-time

Internal MCP upstream on port 3002.

Tools:
- `get_current_time`: return the current ISO timestamp and a formatted time for an optional IANA time zone (default `UTC`).
- `convert_timezone`: format an ISO 8601 instant with an explicit offset in a target IANA time zone.
- `echo`: return a message unchanged.

Transport: stateless Streamable HTTP at `POST /mcp`.
Health check: `GET /healthz`.
Authentication: optional Bearer token via `UPSTREAM_AUTH_TOKEN`; when unset, the internal service does not require bearer authentication.
