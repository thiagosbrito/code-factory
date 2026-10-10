# THI-43: @xyflow/react spike for an alternative Graph editor view

Date: 2026-10-10. Branch: `thi-43-spike` (from `epic/advanced-graph-editor`). Environment: macOS arm64, Node 24.16.0, pnpm 11.8.0, React 19.3.0, Vite 8.3.3, Vitest 5.0.3, jsdom 30.1.1, headless Chromium (Playwright 1234 revision).

The spike code and the dependency are not committed. The experiment files live outside the repository in the session scratchpad (`xyflow-spike/`: `GraphSpike.tsx`, `SpikePage.tsx`, two test files, and patches for `main.tsx` and the dependency). Everything below was measured with real commands, not recalled.

## Recommendation: GO

Adopt `@xyflow/react` 12.12.0 behind a lazy-loaded Graph view; keep the stage Board as the default. It works with the existing toolchain with no casts, costs 57.9 kB gzip only when the Graph view is opened, has an all-permissive license tree, and needs no CSP change. The hard part of this epic is not the library but the domain: free-form edges interact with joins, decisions, and groups, and several rules are missing or only partly enforced (see question 3 and the ticket guidance).

## 1. React 19.3, Vite 8, strict TypeScript

- `pnpm add @xyflow/react` installed `@xyflow/react@12.12.0` with `@xyflow/system@0.0.83`. No peer-dependency warnings; React and React DOM are peers `>=17`, so 19.3.0 is satisfied. Runtime dependencies: `classcat`, `zustand@4.5.7`, `@xyflow/system`, and the d3 modules below.
- `pnpm typecheck` (strict `tsc --noEmit -p tsconfig.json`) passed with the spike component: typed `Node`, `Edge`, `Connection`, `OnConnect`, `Position`, node `handles`, `parentId`, `extent: "parent"`. The only assertions were `as const` literals; no `as` casts, no `any`, no non-null assertions.
- `pnpm build` (tsc + `vite build`) passed with a `React.lazy` import of the spike page. Vite dev served the page and a real Chromium rendered 8 nodes (5 lanes + 3 steps) and 2 edges with zero console errors.

## 2. Connection snapping (`connectionRadius`)

A Playwright script dragged from the `implement` source handle to the `validate` target handle, releasing at increasing offsets from the handle center (diagonal distances shown), and recorded whether `onConnect` fired.

| Release distance from target handle | `connectionRadius=20` (default) | `connectionRadius=40` |
| ----------------------------------- | ------------------------------- | --------------------- |
| 0 px                                | connected                       | connected             |
| ~11 px                              | connected                       | connected             |
| ~28 px                              | not connected                   | connected             |
| ~44 px                              | not connected                   | not connected         |
| ~67 px                              | not connected                   | not connected         |

Conclusion: the built-in snapping is enough for a magnetic feel. Set `connectionRadius` around 40 and keep the default connection line; no custom connection line is needed. The line snaps to the nearest valid handle inside the radius, and the radius is honored on release (the `connectingto` class was not a reliable signal of a connection, only `onConnect` is). Use `isValidConnection` to reject invalid targets before release so users see the rejection while dragging; that path was not exercised in this spike. Note that `onConnect` also fires for an edge that already exists (a repeated drag produced a second callback), so the handler must deduplicate against `loop.dependencies` itself.

## 3. Free-form edges versus the domain rules

Read `validateDependencies`, `validateGroups`, `validateJoins`, `validateDecisions`, `validateAcyclic`, and `parseLoop` in `src/domain/loop.ts`, then ran 35 real `parseLoop` calls (all steps are valid agent steps, status `draft`; `joins`, `decisions`, and groups declared as in the starter templates). Exact issue messages are quoted.

Runtime semantics relevant to fan-in: without a join record, `readySteps` in `src/domain/scheduler.ts` waits for all active incoming edges (mode "all"); a join with mode "any" runs after any active source succeeds.

| Edge change on the loop                                           | Result   | Message or note                                                                                |
| ----------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| Plain step: skip edge `a->c` beside `a->b->c`                     | Accepted |                                                                                                |
| Plain step: fan-out `a->b`, `a->c`                                | Accepted | Implicit parallel branches; no group required                                                  |
| Plain step: fan-in `b->d`, `c->d` with no join record             | Accepted | Scheduler treats as join "all"                                                                 |
| Self loop `a->a`                                                  | Rejected | `Dependency cycles are not allowed; repairs require explicit bounded policy.`                  |
| Back edge `c->a` closing a cycle                                  | Rejected | same cycle message                                                                             |
| Duplicate edge                                                    | Rejected | `Dependencies must be unique.`                                                                 |
| Edge to a missing step                                            | Rejected | `Dependencies must reference existing steps.`                                                  |
| Edge from a later stage lane to an earlier lane (acyclic)         | Accepted | Lanes are presentation only; domain has no stage ordering rule                                 |
| Agent step feeding a check step whose stage is not Validate       | Accepted | The "Check steps belong in Validate" rule lives only in `loop-editor-model.ts`, not the domain |
| Join `d(b,c)` exactly matching its incoming edges                 | Accepted |                                                                                                |
| Add a third incoming edge `a->d` to a join target                 | Rejected | `Join d omits an incoming dependency.`                                                         |
| Remove edge `c->d` while `join.from` still lists `c`              | Rejected | `Join d needs dependency c -> d.`                                                              |
| Remove `c->d` and shrink `join.from` to `[b]`                     | Rejected | `Too small: expected array to have >=2 items` (schema, not a custom message)                   |
| Join target `d` gains an outgoing edge `d->e`                     | Accepted |                                                                                                |
| Self edge on a join target `d->d`                                 | Rejected | `Join d omits an incoming dependency.` and the cycle message                                   |
| Decision `a` with branches to `b`, `c`                            | Accepted |                                                                                                |
| Add a third outgoing edge `a->d` from a decision step             | Rejected | `Decision a omits an outgoing dependency.`                                                     |
| Remove the edge `a->c` that a decision branch uses                | Rejected | `Decision a needs dependency to c.`                                                            |
| New incoming edge into a decision step                            | Accepted |                                                                                                |
| Two decision branches (different outcomes) to the same target     | Accepted | Looks accidental; consider a rule                                                              |
| Parallel group `g(b,c)` with both fed by `a` and both feeding `d` | Accepted |                                                                                                |
| Edge `b->c` or `c->b` between two members of a parallel group     | Rejected | `Parallel group g cannot order its members.`                                                   |
| Edge to or from only one parallel member                          | Accepted | Group does not require all members to share predecessors or successors                         |
| Repeat group: continuation drawn as an edge `c->b`                | Rejected | Cycle message; the continuation lives in `continueWhen`, not in `dependencies`                 |
| Repeat group: edge from outside entering mid-body (`a->c`)        | Accepted | No entry-point rule                                                                            |
| Repeat group: edge leaving the body from a non-exit step (`b->d`) | Accepted | No single-exit rule                                                                            |
| Repeat group: third outgoing edge from the exit decision (`c->e`) | Rejected | `Decision c omits an outgoing dependency.`                                                     |
| Repeat group: remove the exit edge `c->d`                         | Rejected | `Decision c needs dependency to d.`                                                            |
| Edge closing a loop outside the body (`d->a`)                     | Rejected | Cycle message                                                                                  |
| Step `groupId` set but step not listed in `group.stepIds`         | Rejected | `Step a has invalid group g.`                                                                  |

Summary: the domain already guards the structural invariants (existing endpoints, uniqueness, acyclic, join and decision edge parity, no ordering within a parallel group). It does not constrain lanes, check placement, entering or leaving a repeat body, or duplicate decision targets.

Implications for a free-form editor:

- Joins and decisions are derived records tied to edges. A raw `addEdge` onto a join target or out of a decision source fails validation, and a raw delete of an edge listed in a join or decision fails too. Every connect or disconnect on such a node needs a model function that updates the dependency and the `joins` or `decisions` entry in the same `parseLoop` call, as `setJoin` and `setDecision` already do.
- Connecting into a plain step that already has an incoming edge creates implicit fan-in (join "all"). That is valid and the scheduler handles it; the UI can offer to create a join record explicitly to choose "any".
- Connecting out of a plain step that already has an outgoing edge creates implicit fan-out; no decision record is involved.
- Do not render `continueWhen` as an edge in the dependency graph; draw it as a separate, view-only back arrow so it cannot be dragged or confused with a dependency.

## 4. Vitest and jsdom requirements

Findings from runs of the same two-test file with and without mocks:

- Without a `ResizeObserver` stub, render fails with `ReferenceError: ResizeObserver is not defined`. This is the only global that was required.
- `DOMMatrixReadOnly` was not required for plain nodes and edges (verified: the render passed with only the `ResizeObserver` stub). The React Flow docs also stub it for zoom and pan; keep the stub as a cheap guard when adding `Controls`, `MiniMap`, or `fitView` tests (not exercised here).
- Edges do not render in jsdom by default: nodes have no layout, so handle bounds are unmeasured and edges are skipped (observed `edges 0`). Give each node explicit `width`, `height`, and `handles` (v12 supports this for server-side rendering) and the 2 edges render. Under jsdom the layout is therefore deterministic, which also makes node rendering assertions possible.
- Dragging a handle to create a connection depends on real geometry (`getBoundingClientRect`), so do not test `onConnect` through pointer events in jsdom. Test the model functions in Vitest and the drag in Playwright, as done in this spike.

Reusable minimal setup (put in a shared support file and import it from graph tests):

```ts
import { vi } from "vitest";
import { Position, type Node } from "@xyflow/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale === undefined ? 1 : Number(scale);
  }
}

export const stubReactFlowGlobals = (): void => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("DOMMatrixReadOnly", DOMMatrixReadOnlyStub);
};

/** jsdom has no layout: measured size and handles are needed for edges to render. */
export const measured = (node: Node): Node => ({
  ...node,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  width: 200,
  height: 60,
  handles: [
    { type: "target", position: Position.Left, x: 0, y: 30, width: 1, height: 1 },
    { type: "source", position: Position.Right, x: 200, y: 30, width: 1, height: 1 },
  ],
});
```

Call `stubReactFlowGlobals()` in the test file (the file needs `// @vitest-environment jsdom` like the existing UI tests), and call `vi.unstubAllGlobals()` in `afterEach`, as `tests/loops-ui-editor.test.tsx` does. Importing `@xyflow/react/dist/style.css` under Vitest worked without extra configuration.

## 5. Bundle size and licenses

`pnpm build` before and after, with the Graph view imported through `React.lazy` (gzip measured with `gzip -9`):

| Asset                                     | Raw       | Gzip                              |
| ----------------------------------------- | --------- | --------------------------------- |
| Main bundle, baseline (`index-*.js`)      | 790.88 kB | 235.7 kB (Vite reports 238.54 kB) |
| Main bundle, with lazy import glue        | 792.67 kB | 236.5 kB (Vite reports 239.41 kB) |
| Lazy Graph chunk (`SpikePage-*.js`)       | 179.21 kB | 57.1 kB (Vite reports 57.86 kB)   |
| Lazy Graph stylesheet (`SpikePage-*.css`) | 15.41 kB  | 2.6 kB                            |

The lazy cost is about 60 kB gzip, paid only when the Graph view opens. The main bundle change is the spike glue only. The chunk contains the spike component, so the library's own share is slightly under these numbers. Note the baseline main bundle already trips Vite's 500 kB warning.

Licenses, checked from each installed `package.json` and `pnpm licenses list`: `@xyflow/react` MIT, `@xyflow/system` MIT, `classcat` MIT, `zustand` 4.5.7 MIT, `use-sync-external-store` MIT, `d3-color`, `d3-dispatch`, `d3-drag`, `d3-interpolate`, `d3-selection`, `d3-timer`, `d3-transition`, `d3-zoom` ISC, `d3-ease` BSD-3-Clause, and the `@types/d3-*` packages MIT. Everything is permissive. The library shows a small "React Flow" attribution link by default (`https://reactflow.dev`); hiding it is a policy choice (`proOptions.hideAttribution`), not a license restriction on this MIT package. Decide this deliberately in THI-46.

## 6. Mapping and layout

- Nodes: one lane node per stage (`type: "group"`, not draggable or selectable, width `LANE_W - 16`, positioned at `x = laneIndex * LANE_W`), plus one node per step with `parentId = lane:<stageOf(step)>` and `extent: "parent"`. Use `stageOf(step)` from `loop-editor-model.ts` so the Graph view agrees with the Board.
- Edges: one per `loop.dependencies` entry, id `${from}->${to}`, source `from`, target `to`. Handles are Right (source) and Left (target) so edges flow with the stage columns.
- Positions are view-only. The step `position` field exists in the schema but opening the Graph view must never write it. Seed React Flow state from the layout (for example `useNodesState`) and reseed only when the set of steps, stages, or dependencies changes. Use stored `step.position` as a hint only if present; `moveVisual` already treats it as presentation, but do not call it on open. Decide in THI-46 whether dragging persists a position at all; it should not mark the loop dirty or enter undo history.
- Deterministic layout without stored positions: compute a topological rank per step (longest path from a root, with `Math.max(-1, ...incoming ranks) + 1`), sort steps by `(rank, id)`, then give each step in its lane `row = running index within that lane` and place at `x = 16`, `y = 48 + row * 120`. Same loop gives the same result (verified by a Vitest equality test; for the three-step starter each step sits at `{x: 16, y: 48}` in its own lane). Rank ordering keeps fan-out siblings adjacent. Memoize on the structural inputs only. If a lane gets more rows than fit, grow the lane height from the row count.
- The three-step starter (Implement, Review, Validate) renders as steps in lanes Implementation, Review, Validate with two edges, as expected.

## 7. Content-Security-Policy

`src/runtime/server-http.ts` serves `script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'`. Confirmed with the built CLI (`code-factory start`) serving the production build in headless Chromium: the lazy Graph chunk and its CSS loaded from `'self'`, 8 nodes and 2 edges rendered, and the console had zero messages (no CSP violations). Static inspection of the chunk found no `eval`, no `new Function`, no `createElement("style")`, no `fetch` or `XMLHttpRequest`, and no external URL loads (only namespace URIs and the `reactflow.dev` attribution link). `innerHTML` appears inside the d3 modules and is not blocked by CSP. `@xyflow/react/dist/style.css` is bundled by Vite into a separate same-origin stylesheet. No CSP change is needed.

## Guidance for the remaining tickets

- THI-44 (model `addDependency` / `removeDependency`): these must be pure `LoopDefinition -> LoopDefinition` functions that finish with `parseLoop`, following the existing pattern. Required behavior, all confirmed by the matrix above:
  - Reject self edges, duplicates, and cycles up front with readable messages, instead of surfacing raw Zod issues (the domain messages are acceptable but the cycle message does not name the edge).
  - If the target has a join: add the source to `join.from` in the same call. If the source has a decision: do not allow a new plain edge; require a named branch (call `setDecision` with the extra branch). On removal, shrink `join.from`, and if fewer than two sources remain, remove the join record; on a decision source, remove the branch and fail if fewer than two branches remain unless the decision is removed.
  - Reject an edge between two members of the same parallel group with the domain message; do not silently auto-ungroup.
  - Treat `continueWhen` as non-edge; refuse to create or remove it through connect/disconnect.
  - Add tests covering every REJECT row in the table, plus failure leaving the previous loop unchanged.
- Domain rule gaps to decide on (new domain tests first, per `.claude/rules/domain.md`, before the UI offers them): (a) edges into the middle of a repeat body or out of the body from a non-exit step are accepted today; (b) two decision branches may share a target; (c) a check step outside Validate is only blocked by the editor model, so graph edges and imported loops can bypass it; (d) backward-lane edges are valid for the scheduler but may confuse a left-to-right lane layout, so either allow and draw them or warn in the UI. None of these block the epic; flag them as explicit choices rather than leaving them accidental.
- THI-45 (Board/Graph switch): lazy-load the Graph view with `React.lazy` and a suspense fallback, so the main bundle does not grow by about 60 kB gzip. Keep the Board as the default and share the same controller history (`commit`, `undo`, `redo`) so both views edit one `LoopDefinition`. Import the xyflow stylesheet only inside the lazy module.
- THI-46 (nodes, lanes, connections): use the layout in question 6, `connectionRadius` about 40, default connection line, `isValidConnection` calling the THI-44 model in a dry run so invalid targets are rejected while dragging, an `onConnect` handler that dedupes (the library fires it for existing edges), and `onConnect` errors surfaced through the existing error list. Keep nodes controlled from view-only state and do not persist positions on open. Make a deliberate decision about the attribution link.
- THI-47 (groups, joins, decisions): render groups as additional container or badge nodes derived from `loop.groups`, not as stored layout; render joins and decisions as node badges whose edits call `setJoin` and `setDecision`; draw `continueWhen` as a distinct non-interactive arrow. Edge deletion on join or decision nodes must go through the model functions (raw removal fails validation, per the table).
- THI-48 (keyboard): Keyboard behavior was not exercised in this spike; from the library documentation (unverified here) nodes and edges are focusable but no keyboard connection gesture is provided; reuse the existing semantic-move keyboard pattern from the Board for connecting (select a source, then choose a target from a list) rather than relying on the canvas. Test it through Testing Library with the stubs in question 4.
- THI-49 (e2e and docs): drag-to-connect and snapping belong in Playwright; the harness already runs Chromium. This spike ran against `chromium_headless_shell-1234`, while the installed Playwright expects revision 1243, so run `npx playwright install` in CI or locally before trusting an e2e result. Update `docs/architecture.md` (UI section) and the README with the Graph view and its lazy chunk.
