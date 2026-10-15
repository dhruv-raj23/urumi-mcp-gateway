# Security rules (apply to all code)
- Credentials: AES-256-GCM, random 12-byte IV per encryption, key from `CREDENTIAL_ENCRYPTION_KEY`. Decrypt only at call time, in memory.
  Never log, return, or put in errors/audit: credentials, API keys, passwords, session cookies, Authorization headers.
- API responses for servers never include `credentialEnc` or plaintext credentials (write-only).
- API keys: SHA-256 hash stored; constant-time compare (`crypto.timingSafeEqual`); show once.
- Passwords: bcrypt/argon2 only. Cookies: httpOnly, SameSite=Lax, `Secure` when `COOKIE_SECURE=true`.
- Validate every request body with a schema (zod). Reject unknown fields on write endpoints.
- AuthZ checks on the server for every route (role + ownership). UI hiding is not security.
- Never forward the client's `Authorization` header upstream. Upstream gets only its own configured credential.
- Treat upstream tool descriptions and results as UNTRUSTED text: prefix origin, cap sizes (e.g. 100 KB result), never execute them.
- Containers: non-root, `readOnlyRootFilesystem` where possible, drop all capabilities, no privilege escalation.
- Stretch (only after core): block admin-added URLs resolving to loopback/link-local/metadata (169.254.169.254) ranges.
