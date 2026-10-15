# 04 — Threat model (SKELETON — complete in T10; keep updating as you build)
Required topics from the brief. Write real answers, in your own words, based on what the code actually does.

## 1. Shared upstream credentials: what can a member do with a credential they never see?
TODO: A member can invoke any tool the gateway exposes using the shared credential's authority. Describe blast radius,
what limits it (role/tool permissions if implemented, audit, rate limits), and what is NOT limited.

## 2. Why client tokens are not passed through to upstream servers
TODO: confused-deputy / token passthrough; upstream cannot validate audience; credential isolation; revocation semantics.

## 3. Untrusted upstreams: tool descriptions/results written to manipulate the model
TODO: prompt injection via descriptions and results; mitigations implemented (origin prefix, no auto-privileged tools,
results treated as data, iteration cap, audit). Residual risk.

## 4. What can one team member do to another?
TODO: keys are per-user; members cannot see others' keys/audit; shared server state (admin only); chat history isolation;
what a malicious member CAN do (use shared tools).

## 5. Malicious/compromised upstream added by an admin (demo requirement)
TODO: SSRF via URL (cluster-internal / metadata addresses), credential exfil to attacker server, huge responses, slow responses.
Mitigations implemented vs. not.
