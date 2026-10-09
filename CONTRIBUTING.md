# Development guidance

Keep UI, portable domain, runtime, and adapters separate. Prefer small typed modules and immutable data updates. Validate untrusted input at boundaries. Add dependencies only for a concrete need; do not add global state management before shared state demands it.

## TypeScript and React standards

- Keep rendering, state orchestration, domain rules, persistence, and external adapters in their own modules. Split a component when it owns unrelated behavior; give extracted components clear typed props and keep state with the concern it controls. Split by responsibility, not to reach a number: the size limits below are a ceiling that keeps modules reviewable, not a target.
- Prefer composition and explicit interfaces for shared behavior. Avoid inheritance in application code.
- Use arrow functions for all application functions, callbacks, hooks, and React components. Oxlint enforces function expressions and arrow callbacks throughout `src`. Keep class constructors and methods, and generator function expressions such as async streams, where arrow syntax cannot preserve semantics. Document each new exception near its use.
- Keep strict TypeScript contracts across UI, runtime, domain, and adapters. Avoid `any`, unsafe casts, and non-null assertions. Represent domain states precisely and parse untrusted input at the boundary before relying on it.

For final self-review, compare the diff with these rules, check whether concerns remain mixed, and record any remaining debt separately from the ticket scope. Preserve behavior with interaction or domain tests for changed paths. Review application source as well as the diff for remaining declarations, unvalidated external data, mixed responsibilities, and unclear boundaries. Record remaining debt separately with a specific reason.

Run `pnpm check` before considering a change ready. Use meaningful tests for dependency rules, snapshots, adapter event/control behavior, project writes, and the packaged CLI. UI tests should exercise user interactions rather than implementation details.

Do not hardcode provider/model branding into portable loop semantics. Detecting an executable does not authorize work or establish authentication. Preserve existing project files, instructions, agent folders, and pre-existing edits.

Do not present mocks as connected providers. Keep unsupported controls explicit. Agent secrets remain in agent-owned authentication mechanisms; do not copy them into factory configuration.

## Structure and size limits

- Layers depend inward only. `src/domain` never imports `ui`, `runtime`, `adapters` or `translators`; `adapters`, `translators` and `runtime` never import `ui`; the UI never imports `runtime` or `translators` (except the shared `translators/contract.js`). A UI feature (`features/runs`, `features/loops`, `features/setup`) imports `shared/` and the domain, not another feature or the app shell; `shared/` imports no feature. Oxlint rejects violations (`no-restricted-imports` in `.oxlintrc.json`).
- No file may exceed 500 lines in `src/`, `tests/` or `scripts/`; blank lines and comments are not counted (`max-lines`). UI components also warn at 300 lines. There are no per-file exceptions. If one ever becomes unavoidable, list it explicitly with its reason and a follow-up ticket.
- To split a module, keep the old path as a thin entry that re-exports the public names, so importers do not change, and move cohesive pieces into sibling files: pure rules first, then stateful orchestration. Avoid import cycles, and keep module-level state (locks, registries, caches) in exactly one module.
- In the UI, keep data and handlers in hooks and put rendering in small components with typed props, in a folder named after the parent component (`features/runs/run-detail/`). Keep focus management and keyboard behavior with the component that owns it.
- Split tests by behavior, one file per concern, with shared fixtures and builders in `tests/support/` (Playwright harness in `tests/e2e/support/`). When you move tests, record the test count before and after and compare full names; no test may be dropped or weakened.
