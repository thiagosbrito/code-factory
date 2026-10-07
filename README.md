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
pnpm test:e2e:native # opt-in authenticated Codex setup and model selection check
pnpm test:package # production npm installation and packaged CLI/UI smoke test
node dist/node/cli.js --help
node dist/node/cli.js doctor
node dist/node/cli.js init /path/to/project
node dist/node/cli.js start --project /path/to/project
```

The built package serves its bundled UI on http://127.0.0.1:4310. Use `--port 0` to select an available port automatically. Initialization exclusively creates `.code-factory/project.json`; it does not overwrite existing configuration or agent folders. No agent, model, or loop is preselected. `doctor` locates executable candidates without launching them; detection does not establish their identity, authentication, or capabilities.

`pnpm test:e2e` runs browser journeys against disposable projects and fixture adapters. They cover setup and Kiro model selection, loop editing and translation, ticket intake, parallel review, guidance, cancellation, reload, retry, evidence, and mobile controls. `pnpm test:e2e:native` separately checks an installed, authenticated Codex CLI; it does not execute a model turn. The regular browser suite does not require agent credentials or a Linear key.

## Current scope

Versioned loop drafts and published definitions live under `.code-factory/loops`; runs and append-only evidence histories live under `.code-factory/runs`. The Loops screen lists saved definitions and provides a five-stage semantic editor for steps, groups, joins, and decisions. The local API saves drafts and publishes immutable numbered versions after validating outputs and connected bindings. Optional starter templates remain a separate feature. Portable schemas validate dependencies, groups, joins, decisions, bounded repeats, snapshots, attempts, events, guidance, receipts, outputs, provenance and freshness. A deterministic mock implements the step event contract, with unsupported steering/recovery declared explicitly. A Codex app-server adapter implements connection inspection and isolated step turns behind the same contract. The API also exposes health, project configuration, candidate discovery, and an explicit Codex verification handoff. Project defaults persist in `.code-factory/project.json`; verified connections are held only for the current runtime session. Custom agents can use an explicitly selected executable with the verified Codex app-server protocol. Kiro supports authenticated v2 stream execution and explicit model selection from its native catalog; steering and recovery remain unsupported. Cursor and Claude Code remain discovery-only candidates until their adapters are implemented. Kiro workflow recipes can be imported into an empty loop draft (import-only, no execution binding) from the project's `.kiro/workflows`; copy a global recipe first with `mkdir -p .kiro/workflows && cp ~/.kiro/workflows/<name>.workflow.json .kiro/workflows/`.

Task intake saves pending runs from a published loop and a verified agent binding. It snapshots a description, an optional retrieved Linear ticket, and an isolated Git baseline. Creating a run does not start an agent; the run detail has a separate **Execute run** action. The factory scheduler executes declared dependencies, joins, decisions, and bounded repeat groups, saving claims, attempts, candidate hashes, and evidence as it goes. Parallel reviewers receive separate copies of the same frozen candidate. The original working tree, index, current branch and Git config are not modified.

### Run branches

Each run works on a local branch `code-factory/<short-id>` in a `git worktree` created beside your project, at `../<repo>-code-factory/<run-id>`, so you can open it in your editor, inspect it in Source Control and run your tests there. Uncommitted work present at run start is copied in and committed as the branch's first commit ("Code Factory baseline: uncommitted changes at …"). After each successful writing step Code Factory commits the step's changes with your Git identity and your hooks (never `--no-verify`); configure `user.name` and `user.email` first, since Code Factory never changes Git config. A failing hook fails the step and keeps its output as evidence. Reviewers work in throwaway copies and never commit to the run branch. Concurrent runs get separate branches and worktrees.

The run detail shows the branch and worktree path with **Copy branch**, **Copy path** and **Copy open command** (`code`, `kiro` or `cursor` with `-n`; the flag was verified for `kiro` and may need adjusting for other editors). After you accept the evidence, **Create ticket branch** creates a branch named after the ticket (for example `BMAP-1190`, editable; description-only runs ask for a name) pointing at the run branch tip, with the same commits. Existing branches are never overwritten, protected names such as `main` are refused, and nothing is pushed. **Remove worktree…** removes the worktree when it has no uncommitted changes and keeps every branch. Runs created before this change keep their private clone under `.code-factory/workspaces` and stay inspectable. Hooks such as lint-staged that use `git stash` run inside the worktree but share the stash list with your repository.

Fresh worktrees have no installed dependencies. Set an optional setup command in Setup, or as an argv array in `.code-factory/project.json`, to install them once per run before the first step, for example `"setupCommand": ["pnpm", "install", "--frozen-lockfile"]` (or `npm ci`, `yarn install --immutable`). It runs without a shell, its exit code and output tail are kept as evidence, and a failure stops the run before any agent step.

### Agent tool permission

By default Kiro steps trust only `fs_read` and `fs_write`, so they cannot run shell commands such as your tests. Codex runs commands inside its sandbox, and its requests to run a command outside the sandbox are declined. The first time you execute or retry a run with a Kiro or Codex step, Code Factory asks once per provider; declining keeps these defaults ("Run without shell" for Kiro, "Keep commands sandboxed" for Codex). Allowing it stores the grant in `.code-factory/project.json` and reuses it for every later step of that project: Kiro gets `--trust-tools=fs_read,fs_write,execute_bash`, and Codex command approvals are accepted only when the command starts inside the step's worktree or review copy (network prompts and file-change approvals stay declined). An allowed command runs with your account's permissions and can change your repository's branches, stash and config. Revoke it in Setup → Agent tool permission; new attempts then use the default. Each attempt's evidence records which permission it used.

A pending step of a blocked, failed, canceled or rejected run reads **Not reached**, and the run detail names the step that stopped the run. A review that returned `blocked` can be retried like a failed step.

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
