# Packaging plan: publishing Code Factory to npm

Goal: a friend with Node and one supported agent CLI can run, inside any Git repository,

```sh
npx @thiagosbrito/code-factory start
```

open the printed link, verify their agent and run a loop, with no clone, build or configuration.

This document records the decisions taken, the security work that had to land first, the remaining changes, and the release procedure. Update it as steps complete.

## Decisions

| Decision      | Choice                          | Why                                                                                                                                                                                              |
| ------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package name  | `@thiagosbrito/code-factory`    | npm rejects `code-factory` because `codefactory` exists (names that differ only by punctuation are blocked). The user scope cannot be taken by anyone else. The `bin` name stays `code-factory`. |
| License       | MIT                             | Short, permissive, the usual choice for npm CLIs.                                                                                                                                                |
| Access        | public (`publishConfig.access`) | Scoped packages are private by default and would fail to publish.                                                                                                                                |
| First release | `0.1.0`, published by hand      | The first publish proves the account, scope and tarball. Automation follows (step 7).                                                                                                            |

Decided: `start` opens the printed link in the default browser when run in an interactive terminal; `--no-open` skips it. The link carries the session token, so this also saves a copy and paste.

## Security work done before publishing

A pre-release audit found these issues; all are merged into `main`.

| PR  | Finding                                                                                                                                                                                                                                                                                                                                                      | Fix                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #36 | Critical: a cloned repository's committed `.code-factory` run was resumed on `start` and its check command ran with no click. Committed tool grants, setup commands and a saved custom executable were trusted implicitly. A review then found a Python import hijack in the native helper and executables picked up from the project's `node_modules/.bin`. | Project trust, stored outside every project in the user's `trust.json`; nothing runs from an untrusted project; no automatic resume; Python runs isolated (`-I`); Git and Python resolve to absolute system paths. |
| #37 | High: any website could frame the UI and trick clicks (clickjacking).                                                                                                                                                                                                                                                                                        | Content-Security-Policy with `frame-ancestors 'none'`, `script-src 'self'`, no eval, plus `X-Frame-Options: DENY` and related headers; a browser journey runs the packaged UI under the policy.                    |
| #38 | Medium: any local process or account could call the loopback API; the Linear key reached every child process; Git arguments read from run files were not validated.                                                                                                                                                                                          | A random session token per start, exchanged through the printed link for an HttpOnly cookie; the key is removed from the runtime's environment; stored refs are validated.                                         |
| #39 | A flaky journey hid real failures.                                                                                                                                                                                                                                                                                                                           | Fixed a fixture abort race and gave run-progress waits their own timeout.                                                                                                                                          |

Known security debt, accepted for `0.1.0` and listed in `SECURITY.md` once it exists:

- A hostile pop-up plus a double-click trick could still land a click on a dangerous button; COOP cuts the opener link, but a UI-side guard (a button must be visible for some time before it accepts a click) is not built.
- Path comparisons are case-sensitive, so case-insensitive Windows paths are not handled; `taskkill` is launched by bare name; Windows is untested overall.
- If two runtimes find the same stale `trust.json` lock after a crash, both can take it over.
- Prompt injection is inherent: a ticket or repository files can steer an agent, and with the shell grant an agent can do anything the user can. The trust and grant dialogs say so.

## Current state of the package

Measured on `main` with `npm pack --dry-run`: 591 kB packed, 2.0 MB unpacked, 184 files.

- The only runtime dependency is `zod`; the UI is prebuilt into `dist/ui`.
- `files` is `["dist", "docs"]`, which ships all of `docs/evidence` (21 files) and `docs/reviews`. `docs/evidence/thi19-manual-test-guide.md` contains the maintainer's local `/Users/…` paths.
- 52 of the files are source maps.
- `package.json` still has `"private": true`, no `license`, `author`, `repository`, `homepage`, `bugs` or `keywords`, and no `LICENSE` file.
- `pnpm test:package` already packs the CLI, installs it into a scratch consumer with npm, and checks the public API, `init`, the packaged UI, the security headers and the session-token login.
- The CLI has no `--version`, and a busy or forbidden port surfaces a raw error (`listen EACCES: permission denied 127.0.0.1:1`).
- `engines` declares Node `>=22.12.0`, but `npx` ignores `engines`, so an older Node fails with whatever error comes first.

## Remaining work

Steps 1 to 4 are implemented on `feat/npm-packaging` (metadata, CLI first run, README, `SECURITY.md`); the source maps are kept. Steps 1 to 5 are code changes, made on a branch and merged through a PR. Step 6 needs the maintainer's npm account.

### 1. Package metadata

- Rename to `@thiagosbrito/code-factory`, remove `"private": true`, add `"publishConfig": { "access": "public" }`.
- Add `"license": "MIT"` and a `LICENSE` file, plus `author`, `repository`, `homepage`, `bugs` and `keywords`.
- Narrow `files` to `dist` and `docs/architecture.md`. This drops the evidence and review receipts (and the local paths in them) from the tarball; they stay in the repository.
- Decide on source maps: keep them (useful in bug reports, about a quarter of the files) or exclude `dist/**/*.map` from `files`. Recommended: keep them for `0.x`.
- Add `"prepublishOnly": "pnpm check && pnpm test:package"`, so a broken build cannot be published.
- Update `scripts/smoke-package.mjs` for the scoped name (the consumer imports `@thiagosbrito/code-factory`).

### 2. First-run experience in the CLI (`src/cli.ts`)

- Check the Node version before importing the runtime and print `Code Factory needs Node 22.12 or newer (you have X).`
- Add `--version` (read from the package's own `package.json`).
- Turn `EADDRINUSE` and `EACCES` on listen into a sentence that names the port and suggests `--port 0`.
- If the open decision is yes: open the printed link in the default browser, with `--no-open` to skip.
- Extend `scripts/smoke-package.mjs` to cover `--version` and the port message.

### 3. README for people who install it

A short section at the top, before the development instructions:

- Requirements: Node 22.12 or newer; a Git repository with at least one commit and a clean tree; one of Codex, Kiro or Claude Code installed and signed in.
- Run: `cd your-repo && npx @thiagosbrito/code-factory start`, open the printed link, then Setup → Verify connection.
- Safety, in plain words: it listens on `127.0.0.1` only and the link carries a per-start token; it asks once whether to trust a project and lists what that project would run; agents use their own logins; the shell permission is a separate, revocable question.
- Where data lives: `.code-factory/` in the project, `trust.json` in the user configuration folder.

### 4. `SECURITY.md`

How to report a vulnerability (a private GitHub security advisory on the repository), what is in scope, and the accepted debt listed above.

### 5. Release check of the exact tarball

Before publishing, test the tarball that will be uploaded, not the working tree:

1. `pnpm pack` and inspect the file list (no `docs/evidence`, no local paths: `tar -tzf … | grep -v '^package/dist/'`).
2. In a scratch Git repository with one commit: `npx /path/to/thiagosbrito-code-factory-0.1.0.tgz start`, open the link, finish setup, verify Claude Code (or another installed agent), trust the project, and run the starter loop once.
3. Repeat step 2 with Node 22.12 exactly, and confirm an older Node prints the version message.

### 6. Publish `0.1.0`

1. Create the npm account `thiagosbrito` (a user scope must match the username) and turn on two-factor authentication for publishing.
2. Run `! npm login` in the Claude Code prompt, or `npm login` in a terminal.
3. `npm publish` from a clean `main` at the release commit (`prepublishOnly` runs the checks). This is the one irreversible step: a published version number can never be reused, and unpublishing is limited (within 72 hours, and only while nothing depends on it). Pause for explicit approval before running it.
4. Tag the commit `v0.1.0` and push the tag.
5. From a clean directory: `npx @thiagosbrito/code-factory@latest start` and repeat the step 5 journey once.

If something is wrong after publishing, publish a fixed `0.1.1` and `npm deprecate @thiagosbrito/code-factory@0.1.0 "<reason>"`; reach for `npm unpublish` only within its window and only for a release that should never have existed.

### 7. Automate later releases

Implemented in `.github/workflows`: `ci.yml` (check on Node 22.12 and 24, browser journeys, packed tarball with a file-list guard), `security.yml` (CodeQL, production dependency audit, dependency review on PRs, weekly), `release.yml` (on `v*` tags: verify, then publish with provenance and create the GitHub release) and Dependabot. Still manual: the trusted publisher on npmjs.com, an `npm` environment with required reviewers, and branch protection requiring these checks. Actions are pinned to major tags, not commit SHAs.

A GitHub Actions workflow on `v*` tags that runs `pnpm check`, `pnpm test:e2e` and `pnpm test:package`, then publishes with npm trusted publishing (OIDC) and provenance, so no long-lived npm token sits on a laptop or in repository secrets. Configure the trusted publisher on npmjs.com for the repository and workflow file first.

## Verification for each step

- `pnpm check`, `pnpm test:e2e` and `pnpm test:package` pass on the branch before it merges.
- Step 5 is done by hand against the tarball and recorded in the release PR (Node version, agent, result).
- After step 6, the `npx …@latest` run is the acceptance test of the release.
