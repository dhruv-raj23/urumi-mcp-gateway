# T06A — Member-disable backend follow-up

**Purpose:** Complete the backend capability required by T06 dashboard acceptance.

**Decision:** ADR-0014 and `docs/03-contracts.md` define the endpoint behavior.

**Allowed paths:**
- `apps/gateway/src/http/app.ts`
- `apps/gateway/tests/http.test.ts`
- `docs/adr/ADR-0014-member-disable-endpoint.md`
- `docs/03-contracts.md`
- `docs/OPEN_QUESTIONS.md`
- `docs/PROGRESS.md`
- `docs/tasks/T06A-member-disable-endpoint.md`

**Do:**
- Implement admin-only `PATCH /api/users/:id`.
- Accept only strict JSON `{ "status": "disabled" }`.
- Disable active or invited member accounts, clearing invitation token state.
- Keep the operation safe under concurrent requests and idempotent for already-disabled members.
- Preserve the existing behavior that denies sessions and API keys belonging to disabled accounts.
- Add HTTP regression tests for authorization, malformed requests and IDs, missing users, administrator-target rejection, active and invited members, repeat requests, and existing credential invalidation.

**Acceptance:**
- All gateway tests pass.
- `make check` passes.
- `git diff --check` passes.
- The changes are committed separately from the uncommitted dashboard work.
- T06 remains unchecked until the dashboard disable workflow passes browser acceptance.
