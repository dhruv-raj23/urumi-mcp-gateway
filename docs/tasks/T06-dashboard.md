# T06 — Dashboard (React + Vite + TS)
**Depends on:** T03, T04
**Allowed paths:** `apps/dashboard/`, `charts/urumi/templates/dashboard-*`, `charts/urumi/templates/ingress-*`
**Do:** login; servers page (status Connected/Unreachable/Disabled, tools list, add/edit/disable/remove, credential write-only); members (invite, disable); my API keys (create → show once, revoke);
audit log table (filters); chat page (T07 hooks). Admin-only routes hidden AND enforced by API. nginx (non-root) with `/healthz`; Ingress routes `/`, `/api`, `/mcp` (contracts §1-2).
**Acceptance:** all user stories 1–5 (admin) and 1–2 (member) from the brief work in the browser at `http://app.localhost`; no credential visible in browser network tab.
