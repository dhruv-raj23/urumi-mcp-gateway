# Team MCP Gateway + WooCommerce on Kubernetes
Urumi AI FDE Internship — Round 1. Brief: `docs/00-assignment.md` (verbatim). Status: `docs/PROGRESS.md`.

> Scaffold stage. Final README sections (local setup, VPS setup, placing an order, connecting an external MCP client,
> using the chat agent) are completed in task T10.

## Quick start (local)
```bash
make cluster-up                                   # k3d cluster 'urumi', host :80 -> ingress
export LLM_API_KEY=...  BOOTSTRAP_ADMIN_PASSWORD=...   # never commit these
make secrets
make build load deploy
# store:     http://store.localhost      dashboard: http://app.localhost
```
`*.localhost` resolves to 127.0.0.1 in modern browsers and curl (no `/etc/hosts` edit needed); k3d maps host port 80 to Traefik.

## Working with AI agents (Antigravity, Claude Code, Cursor…)
- All agent instructions live in `AGENTS.md` (`GEMINI.md`, `CLAUDE.md`, `.agent/` just point to it).
- Locked names/ports/schemas: `docs/03-contracts.md`. Decisions: `docs/adr/`. Work items: `docs/tasks/`.
- One task per session; agent ticks `docs/PROGRESS.md` only with passing acceptance evidence; run `make check`.
- Ambiguity → agent writes to `docs/OPEN_QUESTIONS.md` instead of guessing.

## Layout
See `AGENTS.md` §5.
