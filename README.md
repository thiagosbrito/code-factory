# Code Factory

A local, agent-independent coding loop factory. React + TypeScript, shadcn/ui, Tailwind, and Vite supply the UI; a Node CLI hosts it and accesses project files. The npm package will include both parts.

## Development

Requires Node >=22.12 and pnpm 11.8.0.

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite (normally http://127.0.0.1:4311). Development runs the UI and API together in one application process, with a dynamically selected API port and `/api` proxy. Vite selects another port if 4311 is occupied. UI hot reload is enabled; runtime changes restart development through tsx watch. `Ctrl+C` shuts down both HTTP servers.

```sh
pnpm check         # format, lint, strict types, tests, production build
pnpm format       # format source
pnpm build
pnpm test:e2e     # fixture-backed browser journey and responsive accessibility checks
pnpm test:package # production npm installation and packaged CLI/UI smoke test
node dist/node/cli.js --help
node dist/node/cli.js doctor
node dist/node/cli.js init /path/to/project
node dist/node/cli.js start --project /path/to/project
```

The built package serves its bundled UI on http://127.0.0.1:4310. Use `--port 0` to select an available port automatically. Initialization exclusively creates `.code-factory/project.json`; it does not overwrite existing configuration or agent folders. No agent, model, or loop is preselected. `doctor` locates executable candidates without launching them; detection does not establish their identity, authentication, or capabilities.

## Current scope

Versioned loop drafts and published definitions live under `.code-factory/loops`; runs and append-only evidence histories live under `.code-factory/runs`. The Loops screen lists saved definitions and provides a five-stage semantic editor for steps, groups, joins, and decisions. The local API saves drafts and publishes immutable numbered versions after validating outputs and connected bindings. Optional starter templates remain a separate feature. Portable schemas validate dependencies, groups, joins, decisions, bounded repeats, snapshots, attempts, events, guidance, receipts, outputs, provenance and freshness. A deterministic mock implements the step event contract, with unsupported steering/recovery declared explicitly. A Codex app-server adapter implements connection inspection and isolated step turns behind the same contract. The API also exposes health, project configuration, candidate discovery, and an explicit Codex verification handoff. Project defaults persist in `.code-factory/project.json`; verified connections are held only for the current runtime session. Custom agents can use an explicitly selected executable with the verified Codex app-server protocol. Cursor, Kiro, and Claude Code remain discovery-only candidates until their adapters are implemented.

Task intake saves pending runs from a published loop and a verified agent binding. It snapshots a description, an optional retrieved Linear ticket, and an isolated Git baseline. Creating a run does not start an agent; the run detail has a separate **Execute run** action. The factory scheduler executes declared dependencies, joins, decisions, and bounded repeat groups, saving claims, attempts, candidate hashes, and evidence as it goes. Parallel reviewers receive separate copies of the same frozen candidate. A writer runs alone inside the run's private clone under `.code-factory/workspaces`. The original working tree is not modified. Concurrent runs use separate clones.

Run activity is persisted with contiguous event sequence numbers and exposed at `/api/runs/:id/events` as cursor replay or a server sent event stream. The browser can reconnect without restarting execution. On service restart, completed persisted work is reconciled; active attempts resume only through an adapter that explicitly supports recovery. Otherwise the attempt is marked interrupted and the run remains unavailable for inspection, with no automatic retry.

Optional Linear retrieval is configured by supplying `CODE_FACTORY_LINEAR_API_KEY` in the runtime process environment. The key is never written to the project or returned by the API. Without it, description-only intake remains available.

## Packaging

```sh
pnpm pack
```

The tarball includes the CLI, compiled portable contracts, built UI, and architecture docs. It is suitable for installation from a local tarball. The package is marked private until its public name and publishing scope are decided. Development uses pnpm; consumers will be able to install the release through npm.

See [architecture decisions](docs/architecture.md) and [development guidance](CONTRIBUTING.md).

To orchestrate development of this repository from Linear, see the
[external Symphony setup](docs/symphony.md).
