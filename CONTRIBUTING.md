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

## Cross-platform CI

`.github/workflows/ci.yml` runs the same suites in separate GitHub-hosted environments on
Ubuntu 24.04, Windows Server 2025 and macOS 15. The main jobs are **Running tests on Linux**,
**Running tests on Windows** and **Running tests on macOS**. Each OS also runs the minimum
Node 22.12 suite, fixture-backed Chrome journeys and packed npm installation smoke test.
Matrices do not cancel other OS jobs when one fails. Browser failure reports, screenshots
and traces are uploaded with the OS in the artifact name. The workflow can also be started
manually from Actions. The tarball file-list audit runs once on Linux.

Windows test jobs compile a test-only native launcher (`scripts/windows-node-fixture.cs`)
that forwards literal arguments and inherited stdio to Node fixture sidecars. A Windows job
object owns each fixture child tree. For local PowerShell testing, run
`./scripts/setup-windows-tests.ps1` before `pnpm test` or `pnpm test:e2e`.
Verification limits for Windows launching (`src/adapters/launch.ts`, the gate script): launch
plans, quoting and discovery order are proven by fixtures on every OS, and the `runIf(win32)`
tests run real `cmd.exe` shims, process-tree cancellation and gate tools on the Windows Server
2025 job. Not verified: a Windows 11 desktop, or real npm-installed Claude Code, Codex or Kiro
CLIs (including their own `.cmd` shim bodies). Kiro receives its instruction as an argument, so a
multi-line instruction cannot reach a `.cmd` launcher and fails with a clear error.
Native filesystem translation is explicitly unsupported on Windows (HTTP 501); its POSIX
integration tests run on Linux/macOS, with a separate Windows unsupported-response test.

Keep shared tests in the existing Vitest and Playwright suites; do not copy them per OS.
For a genuinely OS-specific behavior, use an explicit condition on the test or suite:

```ts
// Native Windows file-sharing semantics cannot be exercised on POSIX.
it.runIf(process.platform === "win32")("retries a Windows file lock", async () => {
  // Exercise the native filesystem with a separate process holding the lock.
});

// NTFS does not expose POSIX executable permission bits.
it.skipIf(process.platform === "win32")("detects executable-bit changes", async () => {
  // Exercise chmod and candidate identity on Linux and macOS.
});
```

For Playwright, call `test.skip(process.platform !== "win32", "Windows-only behavior")`
inside an OS-specific test. State the reason next to every condition. Prefer portable Node
fixtures for shared behavior; a Unix-only fixture is a harness limitation, not a reason to
skip a product capability that should work on Windows. Do not hide platform failures with
`continue-on-error` or blanket suite exclusions.

A regression is verified when the test fails before the fix and passes afterward on its
target OS. Local macOS success does not establish Windows/Linux success: inspect those CI
jobs before claiming cross-platform verification. Windows Server fixtures do not establish
Windows 11 desktop behavior or an authenticated native provider connection. Native proofs
remain separate, opt-in checks requiring the corresponding installed, authenticated CLI.

Job names now include the OS. If branch protection requires the former `Check` status,
update required checks to the new matrix job names in GitHub repository settings.

## Structure and size limits

- Layers depend inward only. `src/domain` never imports `ui`, `runtime`, `adapters` or `translators`; `adapters`, `translators` and `runtime` never import `ui`; the UI never imports `runtime` or `translators` (except the shared `translators/contract.js`). A UI feature (`features/runs`, `features/loops`, `features/setup`) imports `shared/` and the domain, not another feature or the app shell; `shared/` imports no feature. Oxlint rejects violations (`no-restricted-imports` in `.oxlintrc.json`).
- No file may exceed 500 lines in `src/`, `tests/` or `scripts/`; blank lines and comments are not counted (`max-lines`). UI components also warn at 300 lines. There are no per-file exceptions. If one ever becomes unavoidable, list it explicitly with its reason and a follow-up ticket.
- To split a module, keep the old path as a thin entry that re-exports the public names, so importers do not change, and move cohesive pieces into sibling files: pure rules first, then stateful orchestration. Avoid import cycles, and keep module-level state (locks, registries, caches) in exactly one module.
- In the UI, keep data and handlers in hooks and put rendering in small components with typed props, in a folder named after the parent component (`features/runs/run-detail/`). Keep focus management and keyboard behavior with the component that owns it.
- Split tests by behavior, one file per concern, with shared fixtures and builders in `tests/support/` (Playwright harness in `tests/e2e/support/`). When you move tests, record the test count before and after and compare full names; no test may be dropped or weakened.
