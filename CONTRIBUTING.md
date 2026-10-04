# Development guidance

Keep UI, portable domain, runtime, and adapters separate. Prefer small typed modules and immutable data updates. Validate untrusted input at boundaries. Add dependencies only for a concrete need; do not add global state management before shared state demands it.

## TypeScript and React standards

- Keep rendering, state orchestration, domain rules, persistence, and external adapters in their own modules. Split a component when it owns unrelated behavior; give extracted components clear typed props and keep state with the concern it controls. Do not use a line count as a refactoring target.
- Prefer composition and explicit interfaces for shared behavior. Avoid inheritance in application code.
- Write new application functions, callbacks, hooks, and React components as arrow functions. Retain method syntax when a library requires it or an arrow would change `this` or other semantics. Existing declarations do not need a style-only rewrite.
- Keep strict TypeScript contracts across UI, runtime, domain, and adapters. Avoid `any`, unsafe casts, and non-null assertions. Represent domain states precisely and parse untrusted input at the boundary before relying on it.

For final self-review, compare the diff with these rules, check whether concerns remain mixed, and record any remaining debt separately from the ticket scope. Preserve behavior with interaction or domain tests for changed paths. Avoid broad style rewrites and blanket lint rules that add noise without catching a real regression.

Run `pnpm check` before considering a change ready. Use meaningful tests for dependency rules, snapshots, adapter event/control behavior, project writes, and the packaged CLI. UI tests should exercise user interactions rather than implementation details.

Do not hardcode provider/model branding into portable loop semantics. Detecting an executable does not authorize work or establish authentication. Preserve existing project files, instructions, agent folders, and pre-existing edits.

Do not present mocks as connected providers. Keep unsupported controls explicit. Agent secrets remain in agent-owned authentication mechanisms; do not copy them into factory configuration.
