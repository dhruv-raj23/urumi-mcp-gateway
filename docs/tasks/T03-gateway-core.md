# T03 — Gateway: data, auth, API keys, servers CRUD, audit
**Depends on:** T00 (Mongo chart part can be done here)
**Allowed paths:** `apps/gateway/`, `charts/urumi/templates/{mongo,gateway}-*`
**Do:** Mongo StatefulSet+PVC; models per contracts §9; AES-GCM credential crypto; bootstrap admin; login/logout/me; invite+accept; roles;
API key create/list/revoke (hash only); servers CRUD + never returning credentials; audit write function + `GET /api/audit`; zod validation; Dockerfile; chart.
**Acceptance:**
- Unit/integration tests: login, role enforcement (member gets 403 on server CRUD), key hashing (DB has no plaintext), revoke → auth fails immediately,
  server GET/list JSON never contains credential or `credentialEnc`, audit filter by user
- Pod restart keeps data (PVC)
