# Development guidance

Keep UI, portable domain, runtime, and adapters separate. Prefer small typed modules and immutable data updates. Validate untrusted input at boundaries. Add dependencies only for a concrete need; do not add global state management before shared state demands it.

## TypeScript and React standards

- Keep rendering, state orchestration, domain rules, persistence, and external adapters in their own modules. Split a component when it owns unrelated behavior; give extracted components clear typed props and keep state with the concern it controls. Do not use a line count as a refactoring target.
- Prefer composition and explicit interfaces for shared behavior. Avoid inheritance in application code.
- Use arrow functions for all application functions, callbacks, hooks, and React components. Oxlint enforces function expressions and arrow callbacks throughout `src`. Keep class constructors and methods, and generator function expressions such as async streams, where arrow syntax cannot preserve semantics. Document each new exception near its use.
- Keep strict TypeScript contracts across UI, runtime, domain, and adapters. Avoid `any`, unsafe casts, and non-null assertions. Represent domain states precisely and parse untrusted input at the boundary before relying on it.

For final self-review, compare the diff with these rules, check whether concerns remain mixed, and record any remaining debt separately from the ticket scope. Preserve behavior with interaction or domain tests for changed paths. Review application source as well as the diff for remaining declarations, unvalidated external data, mixed responsibilities, and unclear boundaries. Record remaining debt separately with a specific reason.

Run `pnpm check` before considering a change ready. Use meaningful tests for dependency rules, snapshots, adapter event/control behavior, project writes, and the packaged CLI. UI tests should exercise user interactions rather than implementation details.

Do not hardcode provider/model branding into portable loop semantics. Detecting an executable does not authorize work or establish authentication. Preserve existing project files, instructions, agent folders, and pre-existing edits.

Do not present mocks as connected providers. Keep unsupported controls explicit. Agent secrets remain in agent-owned authentication mechanisms; do not copy them into factory configuration.
