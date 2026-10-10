# Claude Code guide for Code Factory

@AGENTS.md

`AGENTS.md` is the canonical repository guide. Follow it together with the
human-facing documentation it names; do not treat this file as a separate or
weaker set of rules.

Before changing behavior, trace the affected path through the portable domain
contract, runtime and persistence, adapter or translator boundary, API client,
and UI. Read the relevant sections of `README.md`, `CONTRIBUTING.md`, and
`docs/architecture.md`, and inspect `git status` before editing.

Use focused tests while iterating and run `pnpm check` before declaring a
change complete. Run `pnpm test:e2e` or `pnpm test:package` when the scope in
`AGENTS.md` requires them. Native proof commands make real provider calls; run
them only when the task explicitly requires native verification.
