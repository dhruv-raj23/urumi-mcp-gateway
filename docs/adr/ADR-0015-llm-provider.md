# ADR-0015: OpenAI-compatible Gemini provider and model fallback

- **Status:** Accepted
- **Date:** 2026-10-23
- **Context:** T07 requires tool calling through a provider-agnostic Chat Completions interface, without adding runtime dependencies. Free-tier model quotas can be exhausted independently, so the gateway needs a bounded fallback strategy.

## Decision

- Use `LLM_PROVIDER=openai-compatible` and the existing Google Gemini OpenAI-compatible endpoint for the initial implementation.
- Use `LLM_MODELS` as an ordered, comma-separated list of model IDs. Helm exposes the list through `gateway.llm.models`. If the list is empty or absent, retain compatibility with `LLM_MODEL`.
- The current local candidate order is `gemini-3.8-flash`, followed by `gemini-3.5-flash-lite`. Both passed a basic text-and-tool-calling smoke test. Confirm current quota availability in AI Studio before live testing; do not assume universal quota limits.
- Use the existing Node.js `fetch`; add no SDK dependency. Model IDs are configuration, not hardcoded router choices.
- Try another candidate only for retryable provider failures before a model has initiated the tool-calling sequence. Never replay a turn on another model after tool execution may have started.
- Treat HTTP 429 and 5xx/network failures as eligible for bounded fallback. Treat 400/401/403 and other non-retryable errors as failures that stop immediately.
- Apply process-local cooldowns keyed by endpoint and model. Daily-quota errors cool down until the next midnight in `America/Los_Angeles`; ordinary 429 errors use a 10-second cooldown; transient server/network failures use a 5-second cooldown.
- Cooldown state is process-local, not shared across replicas. If gateway replicas increase, shared coordination may be needed to prevent repeated requests against exhausted models.
- Preserve Gemini continuation metadata, including thought signatures, within the active model's tool loop.
- Keep `LLM_API_KEY` exclusively in the existing Kubernetes Secret `urumi-gateway`. Never log or return prompts, tool arguments/results, authorization headers, credentials, raw provider response bodies, or raw upstream error details.
- Google documents that free-tier content may be used to improve its products. Use synthetic test-store data rather than real customer information.
- Keep cross-provider routing out of this initial implementation. A provider such as Groq requires a separate approved configuration and secret-management change.

## Consequences

The gateway can move between configured Gemini models when a retryable failure occurs before tool execution, without adding a dependency or requiring a billing upgrade. The behavior is covered by deterministic fake-provider tests. If every candidate is unavailable, the gateway returns a controlled error. Process-local cooldowns do not coordinate across multiple replicas.
