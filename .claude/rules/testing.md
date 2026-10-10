---
paths:
  - "tests/**/*.{ts,tsx}"
  - "vitest.config.ts"
  - "playwright.config.ts"
---

# Test rules

- Place behavior tests at the layer where the rule lives: domain validation and
  scheduling in Vitest, persistence and adapter contracts with disposable
  projects or fixtures, React interactions with Testing Library, and complete
  journeys in Playwright.
- Keep one concern per test file. Put reusable builders and fixtures in
  `tests/support/`; keep the Playwright harness in `tests/e2e/support/` so it is
  not collected as a spec.
- Assert user-visible UI behavior, durable state, emitted evidence, and
  preservation guarantees rather than private implementation details.
- Exercise failure, retry, cancellation, concurrency, reload, corrupt input,
  and no-data paths when the changed semantics make them relevant.
- Use disposable repositories or projects for tests that initialize Git or
  exercise run branches. Never rely on or mutate the developer's checkout.
- The regular end-to-end suite uses fixture providers and no agent credentials.
  Native end-to-end and proof commands are opt-in, may make real model calls,
  and run only when the task explicitly requires native verification.
- When moving or splitting tests, compare the test count and full test names
  before and after; do not drop or weaken coverage silently.
