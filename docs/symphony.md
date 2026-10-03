# Building Code Factory with Symphony

Symphony is an external development service. Its runtime, Git repository, logs,
and ticket worktrees live outside the application. `WORKFLOW.md` and the scripts
in `scripts/symphony/` version the development policy; the product does not depend
on Symphony.

## Local setup

Requires macOS arm64, Node >=22.12, pnpm 11.8, Git, authenticated `codex` and `gh`,
and a Linear API key with access to the Code Factory project. The GitHub account
must be able to push to `thiagosbrito/code-factory` and create pull requests.

Put `LINEAR_API_KEY=...` in the developer checkout's ignored `.env` and run
`chmod 600 .env`. The launcher reads this one value without sourcing the file.
It passes the key to Symphony; the Codex transport strips tracker and GitHub
token variables from worker processes. Workers use Symphony's `linear_graphql`
tool. A host publishing tool uses the host's GitHub CLI credentials. Do not commit authentication files.

```sh
pnpm symphony:install
pnpm symphony:prepare
git push -u origin main
pnpm symphony:doctor
pnpm test:symphony
pnpm symphony:start
```

The installer pins upstream v0.0.3, verifies the release checksum and workspace
source hash, and uses the bundled Erlang/Elixir runtime. No system Elixir install
is needed. Re-running it verifies and rebuilds the local patch. The launcher
refuses to run without the verified patch, authenticated tools, writable GitHub
repository, remote `main`, and Linear project access.

By default, the sibling directory `../code-factory-automation` contains:

```text
repository.git/       automation-owned Git history and shared worktree metadata
workspaces/THI-123/   one real Git worktree per ticket
records/THI-123.json  ownership and preservation records
runtime/             pinned executable, patched module, and checksum manifest
logs/                Symphony logs
```

Set `SYMPHONY_ROOT` to a physical directory to relocate these files; use the same
value for install, prepare, tests, doctor, and start. Do not use symlink aliases.
The developer checkout stays separate. Existing ticket branches are reused;
no branch is reset or deleted by the scripts.

## Dispatch and review

In the [Code Factory Linear project](https://linear.app/thiagosbrito/project/code-factory-e116ab6d4aee),
give a dependency-ready ticket the `symphony-ready` label and move it to `Todo`.
Only labelled tickets in `Todo` or `In Progress` are eligible. There is initially
one worker. Do not opt in a ticket another person or agent is already implementing.

The worker maintains one `Codex Workpad`, implements and validates the ticket,
then calls `symphony_publish_review`. This host tool revalidates the candidate,
commits only explicitly listed ticket files, pushes its assigned `symphony/THI-123`
branch, creates or updates the PR, verifies the published commit and open PR, links
it in Linear, and finally moves the issue to `In Review`. That state pauses work and retains its worktree. Review and merge
the PR yourself, then mark the issue `Done`. To request fixes, add feedback and
return the ticket to `Todo`; the worker preserves its branch, PR, and workpad.
Removing the label prevents new dispatch but does not cancel an in-flight turn;
stop the foreground service when an immediate stop is needed.

All existing product tickets are initially unlabelled. Backlog is not dispatched.
Linear's blocking relations are respected for `Todo`; the worker also checks
prerequisites when it begins an `In Progress` issue. Keep dependent work in Todo
until its prerequisites are Done. Workflow configuration uses Linear's short
project slug ID `e116ab6d4aee`.

## Sessions and cleanup

`pnpm symphony:start` runs in the foreground with a default 45-minute session
limit. Use `SYMPHONY_RUN_MINUTES=15 pnpm symphony:start` for a shorter pilot.
`Ctrl+C` stops the service and its worker process group. A stalled shutdown is
killed after ten seconds. Restart explicitly for another session. This setup
does not install a background login service. The local dashboard is
<http://127.0.0.1:4318>; its state endpoint is `/api/v1/state`.

The workflow's eight turns cap each invocation; Symphony can retry a ticket in
another invocation. The session timer bounds the overall foreground run.
External blockers move the issue to Backlog with a durable workpad note. In Review
is reserved for completed acceptance criteria and a confirmed PR. Publication
failures are recorded in `records/THI-123.json` and pause the issue in Backlog,
preserving files, commits, and any existing PR without a repeated agent retry loop.

Terminal issues (`Done`, `Canceled`, `Duplicate`) trigger cleanup. The hook checks
ownership, branch, tracked and untracked changes, and unpublished commits. It
uses `git worktree remove` without force only when the work is clean and published.
Dirty or unpublished work stays available with a record explaining why. Ignored
files such as dependencies can also cause Git to retain the worktree; inspect
them before removing anything manually. Branches remain for recovery.

Upstream v0.0.3 ignores a failed `before_remove` hook and then recursively removes
the directory. The installer patches the local removal path to propagate that
failure and also preserves nonempty partial workspaces after a creation-hook
failure. Tests exercise the installed module, not just the shell hook. SSH/remote
workers are unsupported by this setup; their upstream cleanup is unchanged.

A crash can leave `daemon.lock` or `workspace.lock`. Inspect its `owner.json` and
the process before removing a stale lock. Never clear a live lock, force-remove
a dirty worktree, or bypass the patched launcher with the original executable.

## Validation

Run `pnpm check` for application changes and `pnpm test:symphony` for orchestration
changes. The latter tests isolation, retry preservation, safe cleanup, ownership,
locking, transport sandbox roots, token stripping, and the installed runtime
patch. The runtime test reports a skip if Symphony is not installed; local setup
validation must include it with no skip. Packaging changes require
`pnpm test:package`. Record local results and actual CI results separately.

The worker defaults to `gpt-6-sol` rather than inheriting the desktop model
from the host Codex configuration. Set `SYMPHONY_CODEX_MODEL` to choose another
model supported by the authenticated CLI account. A model catalog entry alone
does not establish access; verify that an inference turn succeeds.

Symphony v0.0.3 supplies its Linear tool in the legacy dynamic-tool format. The
transport normalizes legacy tool specs to Codex's canonical function format
before adding the publishing tool, preserving existing canonical namespaces.
Codex rejects thread creation when canonical and legacy specs are mixed.

Current Codex reports failed and interrupted turns through `turn/completed`
with a status and error. The transport translates these to the separate failure
and cancellation events expected by Symphony v0.0.3, preserving error details.
This prevents failed turns from being counted as successful continuations.

The transport grants file writes only to the assigned worktree, with network
access. Codex protects linked Git metadata even when its ancestor is explicitly
writable; a `git add` denial is not a GitHub authentication failure. The host
fetches origin before a worker runs. The narrowly scoped publishing tool owns
Git mutations and PR publication. The transport rejects direct Linear updates
to the team's In Review state; workers must use the verified host tool. It checks workspace ownership, assigned branch,
expected remote, explicit file list, local validation, remote commit, PR state,
CI/review blockers, and Linear eligibility. It does not merge or force-push.
A PR URL alone is not completion evidence: required native behavior still needs
its own receipt. Start with one trusted worker and inspect the first PR before
increasing concurrency.

Upstream: [pinned implementation](https://github.com/openai/symphony/tree/v0.0.3).
