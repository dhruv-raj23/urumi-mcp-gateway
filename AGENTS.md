# AGENTS.md — READ THIS FIRST (every session, every agent)

Project: **Team MCP Gateway + WooCommerce on Kubernetes** (Urumi AI FDE internship, Round 1).
Deadline: **26 Oct 2026**. The owner (AJ) must be able to explain every line in a live interview.
So: simple, boring, well-commented-where-non-obvious code beats clever code.

## 1. Source of truth (highest wins on conflict)
1. `docs/00-assignment.md` — the original brief. **Never edit it.**
2. `docs/03-contracts.md` — locked names, ports, schemas, env vars, API shapes.
3. `docs/adr/*.md` — recorded decisions.
4. `docs/tasks/Txx-*.md` — the task card you are executing.
5. `docs/rules/*.md` — topic rules (security, k8s/helm, mcp, testing).
6. Everything else (code, comments, your own memory) — lowest.

If two sources conflict, follow the higher one and note it in `docs/OPEN_QUESTIONS.md`.

## 2. Session protocol
1. Read `docs/PROGRESS.md`. Pick the **first unchecked task** unless the owner names another.
2. Read that task card fully. Touch **only** the paths listed under "Allowed paths".
3. Implement. Run every command under "Acceptance". Paste real output in your summary.
4. Tick the task in `docs/PROGRESS.md` ONLY if all acceptance commands pass.
5. Run `make check`. Fix what you broke. Never disable a check to make it pass.
6. One task = one focused commit (`T03: gateway auth + api keys`).

## 2b. Stop-and-ask protocol
If a requirement is ambiguous, a contract is missing, or you would need to invent a
name/port/schema/env var: **STOP that sub-task**, append the question to
`docs/OPEN_QUESTIONS.md` (with your proposed default), and continue only with unblocked work.
Do not guess silently.

## 3. Hard rules (violations = reject the change)
1. **No secrets in the repo.** No keys, passwords, tokens, even "temporary" or "dev" ones.
   Secrets live in Kubernetes Secrets (created by `scripts/create-secrets.sh`); `.env.example` has names only.
2. **Helm only.** No Kustomize, no raw `kubectl apply` manifests outside `charts/`. Local vs prod differences
   go ONLY in `values-local.yaml` / `values-prod.yaml`.
3. **Only the gateway talks to upstream MCP servers.** Chat agent goes through the gateway code path. Upstream
   MCP services are ClusterIP + NetworkPolicy-restricted; never add an Ingress for them.
4. **Upstream credentials never leave the gateway backend** (not in API responses, logs, errors, MCP responses).
5. **Client API keys are never forwarded upstream** (no token passthrough).
6. **API keys are stored hashed**; shown to the user exactly once.
7. **Every tool call is audited** (success, error, timeout, denied) with the right user.
8. **Every workload has readiness + liveness probes and resource requests + limits**, runs non-root.
9. **Don't change contracts casually.** Changing anything in `docs/03-contracts.md` needs a new ADR first.
10. **No new dependency** without adding a one-line justification to `docs/DEPENDENCIES.md`.
11. **Stay in scope.** No bonus features (multi-store, OAuth, etc.) until every core task is checked.
12. Never edit `docs/00-assignment.md`, never delete tests to get green.

## 4. Anti-hallucination rules
- **Never recall library APIs from memory.** The MCP SDK and Helm/K8s APIs change. Before using a library, read its
  installed typings/README under `node_modules/` (or `helm show`, `kubectl explain`). Quote the real signature
  in a code comment only if non-obvious.
- **Never invent** endpoints, env vars, Helm values keys, tool names, ports, DB fields. Use `docs/03-contracts.md`.
  If it is not there, use the stop-and-ask protocol.
- **Verify, don't assume:** after writing a Helm template run `helm lint` + `helm template`; after writing code run
  tests; after deploying run the task's `kubectl` checks. "It should work" is not evidence.
- If you cannot run something (no cluster, no network), say so explicitly. Do not claim it passed.
- Keep answers/summaries factual: list files changed, commands run, real results, and what is NOT done.

## 5. Repo map
```
docs/            brief, contracts, architecture, ADRs, task cards, rules, progress
apps/gateway     Node/TS: MCP client+server, REST API, auth, audit, chat agent   (port 3000)
apps/woo-mcp     Node/TS: WooCommerce MCP server (Streamable HTTP)               (port 3001)
apps/mcp-time    Node/TS: tiny extra upstream MCP server #2                      (port 3002)
apps/mcp-notes   Node/TS: tiny extra upstream MCP server #3                      (port 3003)
apps/dashboard   React+Vite+TS, served by nginx                                  (port 8080)
charts/urumi     the ONE Helm chart (+ values.yaml, values-local.yaml, values-prod.yaml)
scripts/         cluster-up, create-secrets, checks
```

## 6. Commands
`make help` lists everything. Key ones: `make cluster-up`, `make secrets`, `make build`, `make deploy`,
`make check` (lint + typecheck + test + helm lint + secret scan), `make scaffold-verify`.
