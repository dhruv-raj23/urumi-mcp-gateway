# Testing and style
- TypeScript strict. Lint + typecheck must pass (`make check`).
- Test runner: vitest. Each task adds tests for its acceptance criteria (auth, routing, timeout, collision, revoke, credential-never-leaks).
- Prefer small files, plain functions, explicit names. Comment the *why* of security-relevant code (owner must explain it).
- Conventional commits per task. No `any` without a comment. No commented-out code.
- Docs-as-you-go: when behavior is decided, update the relevant doc in the same commit.
