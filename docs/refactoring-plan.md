# Maintainability refactoring plan

Behavior-preserving refactor of code organization. No user-visible change, no persisted-format change. Tracked in Linear under **Milestone 5 — maintainable code structure**. Source of the findings: audit of file sizes and `src/ui` layout (2026-10-09).

## Principles

- One responsibility per file; a file over 500 lines is split, and a component over ~250 lines is reviewed for extraction.
- Group by feature, not by file kind. Dependencies point `features -> shared`, never the reverse.
- Moves (`git mv`) and logic changes go in separate commits so history and review stay readable.
- Every ticket keeps `pnpm check` green; run `pnpm test:e2e` for UI tickets and `pnpm test:package` when imports, entry points or build output change.
- Follow the existing invariants in `AGENTS.md` (arrow syntax, `.js` suffix for runtime/domain imports, `@/` alias for UI).

## Findings

### 1. Flat `src/ui/` (about 55 files at one level)

Target layout:

| Folder                 | Contents                                                                                                                                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`                 | `App`, `main` (or keep `main.tsx` at the root for `index.html`), `ErrorBoundary`, `ErrorView`, `Brand`                                                                                                                                                                                                          |
| `factory/`             | `Factory`, `FactorySidebar`, `FactoryEmptyState`, `NewRunDialog`, `useNewRunForm`, `TrustDialog`, `ToolGrantDialog`                                                                                                                                                                                             |
| `features/runs/`       | `RunDetail`, `RunWorkspacePanel`, `RunsList`, `RunGraph`, `RunActivity`, `RunEvidenceSummary`, `RunExecution`, `RunGuidance`, `RunInputPrompt`, `RunStopBanner`, `PromoteRunDialog`, `RetryStepDialog`, `RunInspector*`, `useFactoryRuns`, `run-events`, `run-view-model`, `activity-entries`, `inspection-api` |
| `features/loops/`      | `Loops`, `LoopEditor`, `LoopGraphSections`, `LoopGroupList`, `LoopGroups`, `LoopPalette`, `LoopStageBoard`, `LoopStepDrawer`, `NativeTranslation`, `loop-editor-model`, `useLoopEditorController`                                                                                                               |
| `features/setup/`      | `Setup`, `SetupSection`, `AgentSetupSection`, `AgentCandidates`, `AgentCapabilities`, `ModelSetupSection`, `ProjectSetupSection`, `ToolPermissionsSection`, `useSetupController`                                                                                                                                |
| `shared/`              | `Markdown`, `icons`, `clipboard`, `connection`, `project-api`, `zod-config`, `StepBindingSelectors`                                                                                                                                                                                                             |
| `components/ui`, `lib` | Unchanged (`components.json` and shadcn aliases point here)                                                                                                                                                                                                                                                     |

Open decisions: where `TrustDialog`/`ToolGrantDialog` live (used by factory and setup), and where `NativeTranslation` lives. Constraints: 14 test files and `scripts/prove-*.mts` import `src/ui/...` paths; `index.html` references `/src/ui/main.tsx`; `@/` is defined in `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` and `components.json`.

### 2. Components that mix several concerns

- **`RunDetail.tsx` (464):** nav and controls, header with connection status, tracker notice, updates bar, and four dialogs (description, branch, evidence) inline. Panel and focus handlers become `useRunDetailPanels`.
- **`Factory.tsx` (312):** page header, project settings card, demo placeholder, a run-state ladder (loading, error, unavailable, disconnected) and dialog host.
- **`Loops.tsx` (306):** `LoopCard`, library hook (`useLoopsLibrary`), header, starter picker, error list, empty state.
- **`RunWorkspacePanel.tsx` (368):** editor helpers, branch header, commits list, checkout controls, promote form, remove-worktree dialog.
- **`RunInspector.tsx` (297):** tab and effect state, keyboard handling, header and tabs.

### 3. `useFactoryRuns.ts` (555) holds about nine responsibilities

Route selection, run history polling, detail polling, SSE event stream, evidence and workspace polling, permission prompts (trust and tool grants), run commands, branch actions, accept. Also duplicated: the `setRuns(... mergeRunSnapshot)` pattern (about 10 times), the `reportLost` logic (4 times) and the JSON POST boilerplate (3 times).

### 4. Source files over 500 lines

`runtime/scheduler.ts` (1472), `runtime/run-branch.ts` (861), `runtime/server.ts` (767), `adapters/codex.ts` (640), `domain/run.ts` (590), `translators/kiro-workflow-mapper.ts` (557), `ui/useFactoryRuns.ts` (555).

### 5. Test files over 500 lines

`scheduler.test.ts` (1410), `runs-ui.test.tsx` (1292), `run-branch.test.ts` (1184), `e2e/editor-run.spec.ts` (951), `run-branch-ui.test.tsx` (894), `kiro-workflow-import.test.ts` (801), `loops-ui.test.tsx` (656), `adapters.test.ts` (629), `trust.test.ts` (539), `e2e/onboarding.spec.ts` (497, borderline).

## Checklist

Epic: THI-29. Tick each item when its ticket is Done.

- [ ] THI-30: UI folders reorganized by feature (moves and import updates only)
- [ ] THI-31: `useFactoryRuns` split into focused hooks
- [ ] THI-32: `RunDetail` broken into components
- [ ] THI-33: `Factory` and `Loops` broken into components
- [ ] THI-34: `RunWorkspacePanel` and `RunInspector` broken into components
- [ ] THI-35: `runtime/scheduler.ts` split
- [ ] THI-36: `runtime/run-branch.ts` split
- [ ] THI-36: `runtime/server.ts` split
- [ ] THI-37: `adapters/codex.ts`, `domain/run.ts`, `translators/kiro-workflow-mapper.ts` split
- [ ] THI-38: Large Vitest files split by behavior
- [ ] THI-38: Large Playwright specs split
- [ ] THI-39: File-size guardrail enforced in lint, and `AGENTS.md`/`CONTRIBUTING.md` updated

## Suggested order

1. UI folder reorganization (unblocks the UI tickets and gives stable paths).
2. UI component and hook splits, in parallel after step 1.
3. Runtime, adapter and domain splits (independent of the UI work).
4. Test splits, after the code they cover has settled.
5. Guardrail last, so it can be set with no exceptions.
