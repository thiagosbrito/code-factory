# THI-49: Graph editor verification record

Date: 2026-10-10. Environment: macOS arm64, Node 24.16.0, pnpm 11.8.0, headless Chromium through Playwright. Fixture providers only; no agent credentials, nothing published, no version or tag created.

## Automated checks (local)

- `pnpm check` (format, lint, typecheck, Vitest, build): passed.
- `pnpm test:e2e`: passed, including `graph-view-journey.spec.ts` (drag a connection in the Graph, Save, reload, find it in Graph and as an `After:` predecessor on the Board; and the Board stays the default with no Graph chunk requested until the Graph is opened). The Board journeys are unchanged.
- `pnpm test:package`: passed. The packed tarball is installed with `npm`, served, and the smoke test asserts a separate `LoopGraphView-<hash>.js` chunk is shipped and served, and that the entry bundle does not contain the library (`react-flow__` appears in the chunk, not in the entry).
- Bundle (from `pnpm build`): entry `index-*.js` about 798 kB (241 kB gzip); Graph chunk `LoopGraphView-*.js` about 199 kB (65 kB gzip) plus 15 kB CSS.

## Real-project render check

The `triple-a` project was copied (its `.code-factory/` folder, initialised as a throwaway Git repository) and the built CLI was started on it with `node dist/node/cli.js start --project <copy> --port <port>`; the original project was not touched. An 18-step, 23-dependency run was opened and probed in Chromium:

- the run graph lays the cards out in dependency columns: 0 backward edges, 0 connector lines passing behind a card, no clipped card text, every connector attached to the right edge of one card and the left edge of the next, at mid height;
- before the run graph stopped reading editor positions, the same run drew 22 backward or sideways edges.

What was not done here: a manual look at both themes by a person. The owner reviewed the build locally on 2026-10-10 and reported no issues; dark mode and light mode are covered by the automated `dark-mode.spec.ts` and the theme token tests.

## Licenses

See the table in [architecture.md](../architecture.md#advanced-graph-editor); all packages are MIT, ISC or BSD-3-Clause.
