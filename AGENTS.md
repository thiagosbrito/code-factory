# Agent guide for Code Factory

This file is the entry point for agents working in this repository. Read `README.md`, `CONTRIBUTING.md`, and the relevant parts of `docs/architecture.md` before changing behavior.

## Project overview

Code Factory is a local, agent-independent coding loop factory. One npm package contains a Node CLI/runtime and a React UI. Users define portable, versioned loops, verify an agent connection, create a pending run from a published loop, then explicitly execute it. The factory owns scheduling, snapshots, evidence, and run branches; an adapter owns one provider step at a time. Native agent files are imported or exported through translators, separately from execution.

Current stack: Node >=22.12, pnpm 11.8.0, strict TypeScript, React 19, Vite 8, Tailwind 4, Zod 4, Vitest, and Playwright. The built CLI and declarations go to `dist/node`; the static UI goes to `dist/ui`.

## Where changes belong

| Path               | Responsibility                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `src/domain/`      | Portable schemas, types, validation, and run/loop rules; no provider or UI assumptions.             |
| `src/adapters/`    | Provider discovery, verification, capabilities, and execution behind `contract.ts`.                 |
| `src/runtime/`     | Local API, persistence, Git worktrees, scheduling, intake, events, and provider coordination.       |
| `src/translators/` | Explicit import/export of agent-native configuration, with loss reporting.                          |
| `src/ui/`          | React screens, hooks, API clients, and presentation; `src/ui/components/ui/` holds shared controls. |
| `tests/`           | Vitest domain/runtime/UI tests, provider fixtures, and `tests/e2e/` browser journeys.               |
| `scripts/`         | Development, package smoke, and native proof tooling.                                               |
| `docs/`            | Architecture decisions and dated evidence.                                                          |

Trace a behavior through domain contract, runtime route/storage/scheduler, API client, and UI before editing. Keep rendering, state orchestration, domain decisions, persistence, and provider protocol code in their respective modules. Add or change a portable contract before teaching multiple layers a new state.

## Project invariants and coding patterns

- Preserve the portable boundary: loop roles, instructions, steps, dependencies, groups, joins, and decisions must not assume a provider or model. Resolve bindings once into the run snapshot. The factory scheduler is the sole graph owner; adapters execute assigned steps.
- Parse untrusted API, disk, native-file, and provider data at their boundaries. Use strict types and Zod schemas; avoid `any`, unsafe casts, and non-null assertions. Corrupt persisted data should produce a useful error, never a silent reset.
- Keep evidence and run identity durable. Published loop versions and run snapshots are immutable; attempts, events, receipts, and other evidence are append-only. Preserve revision checks, contiguous event sequence numbers, and idempotent intake semantics when modifying storage or APIs.
- Treat executable discovery, authentication, model availability, and capabilities as separate facts. Do not present mocks as live providers or expose a control until its adapter supports it. Keep credentials in provider-owned authentication; do not put secrets in project configuration or API responses.
- Preserve user-owned project content. `.code-factory/` stores factory data; existing agent folders and instruction files belong to the user. Native translation must preview conflicts and semantic loss and must not silently overwrite native files. Run worktrees and branches must leave the original checkout, index, branch, and Git config alone.
- Prefer small cohesive typed modules, composition, explicit interfaces, and immutable updates. Application functions, callbacks, hooks, and React components use arrow syntax; document a semantic exception where arrow syntax cannot work. Follow `CONTRIBUTING.md` for the full style and review rules.
- Use ESM imports with `.js` suffix for relative imports in runtime/domain/adapter TypeScript that compiles to Node ESM. The `@/` alias is for UI code.

## Development and verification

```sh
pnpm install
pnpm dev                 # UI and local API; Vite usually serves 127.0.0.1:4311
pnpm check               # format:check, lint, typecheck, Vitest, build
pnpm test:e2e            # fixture-backed Chromium browser journeys
pnpm test:package        # packed CLI/UI installation smoke test
```

Use `pnpm format` for formatting. Run focused Vitest or Playwright cases while developing, then `pnpm check` before considering a change ready. Add behavior tests at the layer where the rule lives: domain validation and scheduling in Vitest; persistence, API and adapter contracts with disposable projects/fixtures; React interactions with Testing Library; complete browser journeys in Playwright. Exercise failure, retry, and preservation paths when those semantics change. UI tests should assert visible behavior rather than component internals.

Run `pnpm test:package` when the CLI, build output, package contents, or static serving changes. `pnpm test:e2e` uses fixture providers and needs no agent credentials or Linear key. `pnpm test:e2e:native` requires an installed, authenticated Codex CLI. Native proof scripts such as `pnpm prove:codex` make real model calls; run them only when the task calls for native verification and record the environment and limits of the result. A fixture pass is not proof of a live provider connection.

## Working safely in this repository

Inspect `git status` before editing and preserve unrelated edits and untracked files. Do not edit generated `dist/`, browser reports, dependencies, or local `.env` files. Use disposable projects/worktrees for tests that initialize repositories or exercise run branches. Avoid reading or copying authentication files. Keep documentation in sync when changing user-visible commands, persisted formats, provider support, or architectural invariants. In the final review, inspect the diff, note any remaining debt separately, and report the checks actually run.
