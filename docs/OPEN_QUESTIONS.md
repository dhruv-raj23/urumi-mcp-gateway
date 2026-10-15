# OPEN QUESTIONS (agents append; owner resolves)
Format: `- [ ] (Txx) question — proposed default — status`

- [ ] (T01) WooCommerce REST key auth over plain HTTP inside the cluster: WC normally requires HTTPS for Basic auth (else OAuth1).
  Options: (a) mu-plugin making `is_ssl()` true for in-cluster requests, (b) send `X-Forwarded-Proto: https` and make WP trust it,
  (c) WP Application Passwords. Default: try (b) then (a). MUST be verified by a real request, then recorded in ADR-0003.
- [ ] (T07) Which free LLM provider/model supports tool calling reliably (Gemini OpenAI-compat, Groq, Ollama)? Default: Gemini via OpenAI-compatible endpoint.
