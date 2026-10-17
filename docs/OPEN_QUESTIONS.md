# OPEN QUESTIONS (agents append; owner resolves)
Format: `- [ ] (Txx) question — proposed default — status`

- [x] (T01) WooCommerce REST key auth over plain HTTP inside the cluster — resolved using option (b): send `X-Forwarded-Proto: https`; WordPress maps it to HTTPS for WooCommerce authentication. Verified with an in-cluster request to `/wp-json/wc/v3/products`: HTTP 200, response `[]`. See ADR-0003. The connection remains HTTP, so only trusted callers may reach the WordPress Service; network restrictions are still required.
- [ ] (T07) Which free LLM provider/model supports tool calling reliably (Gemini OpenAI-compat, Groq, Ollama)? Default: Gemini via OpenAI-compatible endpoint.
- [x] (T01) WordPress database name and application DB username — decision: database `wordpress`, user `wordpress`, password from `urumi-mariadb` key `MARIADB_PASSWORD` — resolved by ADR-0008.
- [x] (T01) WooCommerce store currency — decision: `INR` — resolved by ADR-0008.
- [x] (T01) WordPress internal Apache container port — decision: Apache listens on unprivileged port `8080`, named `http`; Service port remains `80` with `targetPort: http`, and Ingress routes to Service port `80`. Probes target the container port using `/wp-login.php` or TCP as appropriate — resolved by ADR-0008.
- [ ] (T08) WordPress NetworkPolicy port — WordPress Pods receive traffic on container port `8080` (`http`), not Service port `80` — proposed default: allow required Pod ingress on TCP/8080 while public Ingress routes through Service port 80 — reminder for T08; do not use the Service port as the Pod port.
