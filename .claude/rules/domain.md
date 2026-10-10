---
paths:
  - "src/domain/**/*.ts"
---

# Portable domain rules

- Keep domain contracts independent of providers, models, the runtime, and the
  UI. Roles, instructions, steps, dependencies, groups, joins, decisions, and
  bounded repeats must remain portable.
- Express states precisely with strict TypeScript and Zod schemas. Parse
  untrusted values before using them; do not use `any`, unsafe casts, or
  non-null assertions to bypass a contract.
- Add or change the portable contract before teaching the runtime, adapters,
  translators, or UI about a new state.
- Resolve provider bindings once into the run snapshot. The factory scheduler,
  not an adapter, owns graph traversal and scheduling decisions.
- Preserve immutable published loop versions and run snapshots. Attempts,
  events, receipts, and evidence are append-only.
- Put tests for validation, dependency rules, scheduling semantics, snapshots,
  attempts, and outcomes in focused Vitest files under `tests/`.
