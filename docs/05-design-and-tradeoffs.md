# 05 — System design and trade-offs

## 1. Architecture

Ingress publishes the dashboard and gateway under `app.<domain>` and the
storefront under `store.<domain>`. The gateway handles browser sessions,
MCP API-key authentication, upstream discovery and routing, audit logging,
and the chat agent. The Woo MCP translates tool calls into WooCommerce REST
API v3 operations. WordPress/WooCommerce uses MariaDB; MongoDB stores gateway
users, API-key metadata, server configuration and audit records.

See [02-architecture.md](02-architecture.md) and [03-contracts.md](03-contracts.md).

## 2. One Helm chart and environment values

A single chart keeps workload definitions, security settings, probes,
resources, persistence and ingress routes consistent between local k3d and
a production-like VPS. The local and production values files vary domains,
TLS, cookie security, image references, storage configuration and resource
settings without maintaining separate charts.

The trade-off is that production still needs environment-specific validation:
DNS, certificates, image availability, storage, Secrets, backups and actual
application health. The production values reference GHCR images that must be
published and verified before deployment. A successful render alone does not
prove the VPS will work.

See [ADR-0001](adr/ADR-0001-single-helm-chart.md) and [07-production.md](07-production.md).

## 3. Stateless gateway and MongoDB

The MCP endpoint uses stateless Streamable HTTP, avoiding an MCP session
store and simplifying replacement of gateway pods. Browser sessions are
signed cookies rather than server-side session records. This reduces
session-state operations, but an individual cookie cannot be immediately
revoked after logout; it may remain valid until expiry unless the account
is disabled.

MongoDB fits document-shaped users, API keys, server records and audit events.
Unique indexes enforce uniqueness for user email, key prefix and server slug.
The trade-off is responsibility for persistence, indexes, backups and restore
validation.

See [ADR-0002](adr/ADR-0002-stateless-gateway-mcp.md),
[ADR-0004](adr/ADR-0004-mongo-for-gateway.md), and ADR-0009.

## 4. WooCommerce REST API

The Woo MCP calls WooCommerce REST API v3 instead of accessing WordPress or
MariaDB tables directly. This preserves WooCommerce's API-level validation
and avoids coupling tool code to plugin database internals. It adds an
HTTP dependency: a WordPress failure can make Woo tools fail, while separate
Time and Notes upstreams should continue to work.

See [ADR-0003](adr/ADR-0003-woo-rest-api.md) and ADR-0006.

## 5. Aggregation, routing and failures

Tool names are exposed as `<serverSlug>__<toolName>`. For example,
`time__echo` and `notes__echo` distinguish the two upstreams that both
provide `echo`.

Discovery queries enabled, connected upstreams in parallel with timeouts.
A failing upstream can be omitted from the combined tool list rather than
failing all discovery. Calls route by the slug prefix and use the stored
upstream credential. Timeouts and unavailable upstreams produce clear tool
errors, and audit entries record the acting user, source, server, tool,
duration and outcome.

This gives clients one MCP endpoint and helps isolate individual upstream
failures. The gateway is still a shared trust boundary: malicious tool
descriptions/results may influence the model, and timeouts alone do not
prevent every resource-exhaustion scenario.

See [ADR-0005](adr/ADR-0005-chat-through-gateway-path.md) and [03-contracts.md](03-contracts.md).

## 6. Authentication and audit choices

Client API keys are stored as hashes and can be revoked. Upstream credentials
are encrypted in MongoDB and used on the server side; client keys are not
forwarded upstream. Audit logs store identity, source, tool, server, duration
and outcome, plus an argument hash instead of full tool arguments.

This reduces credential and customer-data exposure in records, but an audit
entry cannot reconstruct every original argument. Audit logging supports
investigation; it complements authorization checks but does not replace comprehensive rate limiting.

## 7. Chat agent

The chat agent uses an OpenAI-compatible Chat Completions interface. It gets
its tools from the same aggregator as external MCP clients and invokes them
through the user-aware path, so audit events identify the user and `source=chat`.
The tool loop is capped at eight iterations, and provider configuration is
server-side.

The trade-off is dependency on provider availability, quota, latency and
policy. Tests cover configured fallback behavior, but a real quota-triggered
provider failover should not be claimed unless it has been observed.

See [ADR-0015](adr/ADR-0015-llm-provider.md).

## 8. Kubernetes security and production trade-offs

Workloads use probes, resource requests/limits and hardened container
security settings checked by the chart policy script. NetworkPolicies restrict
service paths; upstream MCP Services are not published through a public
Ingress. Local testing demonstrated that the gateway could reach its
upstreams and an ordinary unauthorized pod could not reach Woo MCP.

These controls do not constitute comprehensive SSRF protection. Arbitrary
admin-added URLs are not protected by a complete destination filter, and
TCP 443 egress remains broad for external provider access. Role-based
tool authorization is implemented with an explicit admin/member allowlist.
It is not a configurable per-user policy, and comprehensive per-user rate
limits are not implemented.

The local Helm upgrade/rollback rehearsal demonstrated rollback of a visible
replica-count change. It did not demonstrate a production VPS deployment.

## 9. Internal tool-call observability

The gateway exposes Prometheus text-format metrics at `GET /metrics`:

- `urumi_gateway_tool_calls_total` counts tool-call attempts by server and
  outcome (`success`, `error`, `timeout` or `denied`).
- `urumi_gateway_tool_call_duration_seconds` is a latency histogram with
  cumulative buckets, sum and count, using seconds.

Labels are restricted to server slug and outcome; user identity, API keys,
tool arguments and tool names are not exported as metric labels. Denied calls
are counted along with successful and failed calls.

The endpoint is intentionally not mapped through the public Ingress. It can
be inspected through a Kubernetes port-forward. No Prometheus deployment or
scrape configuration is included. Metrics are held in process memory, reset
when a gateway process restarts, and are not aggregated across replicas.
This is lightweight instrumentation, not production-grade monitoring or
durable historical telemetry.

## 10. Remaining limitations

1. SSRF destination filtering and redirect/DNS protections need implementation.
2. Tool authorization is a fixed role-based allowlist, not a configurable
   per-user permission editor. Comprehensive per-user rate limiting remains
   future work.
3. Individual browser session revocation after logout is not implemented.
4. Production GHCR image accessibility, DNS/TLS and a live VPS deployment
   have not been verified.
5. Production-grade monitoring, backup/restore and load testing require further
   validation before handling real customer data.
