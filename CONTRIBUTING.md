# Development guidance

Keep UI, portable domain, runtime, and adapters separate. Prefer small typed modules and immutable data updates. Validate untrusted input at boundaries. Add dependencies only for a concrete need; do not add global state management before shared state demands it.

Run `pnpm check` before considering a change ready. Use meaningful tests for dependency rules, snapshots, adapter event/control behavior, project writes, and the packaged CLI. UI tests should exercise user interactions rather than implementation details.

Do not hardcode provider/model branding into portable loop semantics. Detecting an executable does not authorize work or establish authentication. Preserve existing project files, instructions, agent folders, and pre-existing edits.

Do not present mocks as connected providers. Keep unsupported controls explicit. Agent secrets remain in agent-owned authentication mechanisms; do not copy them into factory configuration.
