# THI-49: Graph editor verification record

Date: 2026-10-10. Environment: macOS arm64, Node 24.16.0, pnpm 11.8.0, headless Chromium through Playwright. Fixture providers only; no agent credentials, nothing published, no version bump and no tag created. This record states what was run and what was not.

## Run locally on this branch

- `pnpm check` (format, lint, typecheck, Vitest, build), `pnpm test:e2e` and `pnpm test:package`: all passed on the PR head, and the PR's CI re-runs them.
- `graph-view-journey.spec.ts` (new): drag a connection in the Graph, Save, reload, and find the same dependency in the Graph and as an `After:` predecessor on the Board; and the Board is the default view and the Graph module is not requested until the Graph is opened. The e2e harness serves the Vite dev server, so this observes the dev module `LoopGraphView.tsx`; it does not observe the built chunk. The Board journeys are unchanged and pass.
- `scripts/smoke-package.mjs`: installs the packed tarball with `npm --omit=dev`, serves it, and asserts one `LoopGraphView-<hash>.js` chunk and its `.css` are shipped, the JS chunk is served and contains the library (`react-flow__`), and the entry bundle the page loads does not.
- Bundle (from `pnpm build`): entry `index-*.js` about 798 kB (241 kB gzip); Graph chunk `LoopGraphView-*.js` about 199 kB (65 kB gzip) plus 15 kB CSS.

## One-off manual observation (not reproducible from this repository)

The `triple-a` project was copied (its `.code-factory/` folder, initialised as a throwaway Git repository) and the built CLI was started on the copy; the original project was not touched. An 18-step, 23-dependency run was opened in Chromium and measured with an ad-hoc script that is not committed: 0 backward edges, 0 connector lines passing behind a card, nothing clipped, every connector attached to the right edge of one card and the left edge of the next at mid height. The same script on the code before the run graph stopped reading editor positions (`60a2464`) counted 22 backward or sideways edges. Treat these counts as an observation by the author, not as a repeatable test; the behavior itself is covered by `tests/runs-ui-graph-and-history.test.tsx` (a run ignores positions saved by the editor).

## Not verified

- No test opens the Graph view in both themes for contrast. `graph-view.spec.ts` checks that the Graph follows the theme toggle (its background changes in dark mode); `dark-mode.spec.ts` checks contrast on the Board editor and the Runs screen only. A person's look at both themes of the Graph was reported by the owner in conversation on 2026-10-10 and was not observed by the author.
- No screen reader was used. The keyboard flows are covered by Testing Library and Playwright tests that read focus and text, not speech.

## Licenses

See the table in [architecture.md](../architecture.md#advanced-graph-editor); all packages are MIT, ISC or BSD-3-Clause, and `@xyflow/react` is a development dependency bundled into `dist/ui`, so the published package has no new runtime dependency.
