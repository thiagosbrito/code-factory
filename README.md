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
pnpm test:package # production npm installation and packaged CLI/UI smoke test
node dist/node/cli.js --help
node dist/node/cli.js doctor
node dist/node/cli.js init /path/to/project
node dist/node/cli.js start --project /path/to/project
```

The built package serves its bundled UI on http://127.0.0.1:4310. Use `--port 0` to select an available port automatically. Initialization exclusively creates `.code-factory/project.json`; it does not overwrite existing configuration or agent folders. No agent, model, or loop is preselected. `doctor` locates executable candidates without launching them; detection does not establish their identity, authentication, or capabilities.

## Current scope

This is the layout-independent foundation. Loop schemas validate dependencies and published/nonempty definitions. Runs can snapshot task inputs and resolved agent/model defaults. A deterministic mock implements the step event contract, with unsupported steering/recovery declared explicitly. A Codex app-server adapter implements connection inspection and isolated step turns behind the same contract; its native execution controls still require a live disposable-project receipt. The local HTTP API currently exposes health, project configuration, and discovered candidates only.

There is no connected production runner, production scheduler, durable event journal, saved loop registry, ticket integration, or real file-changing run yet. The mock adapter is a protocol fixture, not a live coding agent. Run snapshots are detached copies; immutable publication and persisted run storage are subsequent work. The small connection shell will be replaced with approved Figma screens.

## Packaging

```sh
pnpm pack
```

The tarball includes the CLI, compiled portable contracts, built UI, and architecture docs. It is suitable for installation from a local tarball. The package is marked private until its public name and publishing scope are decided. Development uses pnpm; consumers will be able to install the release through npm.

See [architecture decisions](docs/architecture.md) and [development guidance](CONTRIBUTING.md).

To orchestrate development of this repository from Linear, see the
[external Symphony setup](docs/symphony.md).
