# THI-19 release acceptance, 2026-10-06

## Candidate

- Assigned branch: `symphony/THI-19`; starting commit `9a5545c09aed25c3dd539bbb94ffc85f8420d307`. The branch is two workflow-policy commits behind `origin/main`.
- Package version: `0.1.0`. The worktree contains the Kiro stream adapter, connection UI/registry wiring, protocol fixture tests, native proof scripts and receipts, and a CLI message correction. A draft implementing PR will identify the committed candidate; acceptance remains incomplete until the remaining gates below are met.
- All ten issue prerequisites were Done when checked. This receipt is partial validation, not human acceptance.

## Fresh checks

- `pnpm check`: passed formatting, Oxlint, TypeScript, 24 Vitest files / 156 tests, and production build after aligning Kiro parsing with live nested stream events and explicit model selection. Vite reported a chunk-size warning. This remains a mutable candidate until final proof and publication.
- `pnpm test:package`: passed a clean production-only install from the packed npm artifact, public API, blank initialization preserving an existing `.kiro` file, duplicate-initialization rejection, packaged UI/assets/API serving, and shutdown. No consumer frontend build dependencies were installed.
- `git diff --check`: passed.

The passing behavior suite includes onboarding and connection state, loop editing/import, run graph and inspectors, guidance and retry, acceptance freshness and explicit acceptance, native configuration preview/import/export, and runtime recovery. These are automated fixture tests; they are not a new end-to-end native execution receipt.

## Native and UI proof limits

- The execution registry now implements Codex app-server and Kiro v2 `stream-json`. Custom executables must speak the verified Codex protocol. Cursor and Claude Code remain discovery-only. The Kiro fixture covers connection, event/session mapping, process failure, explicit catalog model selection, and unsupported steering/resume. Kiro supports its CLI default or a catalog model, but no effort override; the adapter cannot reattach or guide an active step. An unrestricted disposable run executed the same parsed one-step portable loop and task snapshot through each adapter; both runs succeeded, emitted lifecycle/tool/message evidence, and wrote the requested project file. The paired receipt is `thi19-two-provider-runtime-proof-2026-10-06.json`. A separate unrestricted Kiro receipt, `thi19-kiro-model-reconnect-proof-2026-10-06.json`, records a selected catalog model, service restart requiring connection re-verification, and successful native file edit after reconnect.
- The user signed in to local `kiro-cli 2.27.1` after the initial blocked attempt. `kiro-cli whoami` now succeeds. Code Factory's Kiro adapter was exercised against that authenticated CLI in the paired native runtime proof.
- In the worker sandbox, Kiro ACP session initialization still fails. Outside that sandbox, the v2 stream and Code Factory adapter both succeeded. Initial fixture tests assumed flattened stream fields and missed native `data` envelopes, repeated metadata, and tool-call update content. The adapter and fixtures were corrected against a real native stream; the paired runtime proof now exercises the corrected mapping.
- A fresh `pnpm prove:codex` attempt with `codex-cli 0.160.0` passed in an unrestricted disposable environment after the worker-sandbox attempt failed at `initialize` with `Operation not permitted (os error 1)`. The receipt at `docs/evidence/thi19-codex-native-proof-2026-10-06.json` records authenticated connection, stable run/step/attempt identity, streaming, project edits, `turn/steer` guidance, reconnect recovery, a controlled unavailable-model failure, and selected retry success. It does not prove the complete factory UI journey or a second provider.
- The packaged CLI started a disposable local project in an unrestricted environment. Browser observations in `thi19-browser-native-journey-2026-10-06.md` cover Kiro connection and capability labels, draft edit and publish, description-only intake, native run completion, graph and inspectors, file diff and provenance, browser reload and service restart without duplicate work, keyboard Enter/Escape, and a 390 × 844 viewport. The browser console reported no warnings or errors. Configured ticket intake, parallel review, guidance, selected retry, stale evidence rejection, explicit acceptance, and reduced-motion emulation remain unobserved as one final native browser journey. The generated CSS contains the reduced-motion media rule for the shared button style.
- Native configuration translation is implemented only for Cursor project rules. Preview/import/export preserves existing native files and reports unsupported fields and semantic losses; it does not provide native execution. See `docs/architecture.md` and `tests/native-translation.test.ts`.

## Remaining acceptance work

Obtain a fresh full factory browser journey receipt, including configured ticket intake, parallel review, guidance, selected retry, evidence freshness, explicit acceptance, and reduced-motion emulation. The attempted in-worker browser control was rejected by automatic approval review, so this proof requires an approved browser session or an unrestricted reviewer receipt. Rerun final checks on the resulting candidate, review the diff and CI/review feedback, then publish the implementing PR through the Symphony host workflow before requesting human acceptance. Registry publication and deployment remain separate release actions.

## Finalization work, 2026-10-06

Authenticated Kiro model discovery and explicit `--model` forwarding now have native claude-haiku-4.5 proof. Service restart preserves the saved binding but requires explicit connection verification; selecting that same model works after reconnect. Active Kiro subprocesses are terminated when their connection closes. Regression tests cover native concatenated finalText with pre-tool commentary, preserving streamed activity while returning the final answer for review verdicts. See `thi19-kiro-model-reconnect-proof-2026-10-06.json` and reproducible bounded `scripts/prove-kiro.mts`.

The native multi-step HTTP journey (`scripts/prove-journey.mts`) uses a configured tracker fixture, actual Kiro writer and parallel reviewers, a real intentionally failing local check, selected retry, current evidence, explicit acceptance, and stale-evidence rejection. It does not claim a live Linear retrieval or combined browser journey. A retry race was found when persisted terminal status preceded active execution cleanup; the proof currently waits 250ms after terminal status, and THI-28 owns the runtime repair.

## Retained candidate validation

At commit `5f83b97f5c749fd33949d40c8497885297b2554e`, with only `docs/evidence/thi19-manual-test-guide.md` modified in the worktree, `pnpm check` passed formatting, Oxlint, strict TypeScript, 24 Vitest files / 157 tests, and production build. Vite emitted the existing chunk-size warning. `pnpm test:package` passed the production-only npm install, public API, blank initialization and preservation, packaged UI/assets/API, and clean shutdown. `git diff --check` passed. PR #28 is open at the same remote commit; GitHub reported no CI checks or reviews.

This historical validation predates the combined candidate receipts below. The manual guide is now included in the draft update. Live Linear retrieval remains unverified because no runtime key is configured.

## Combined candidate validation, 2026-10-06 21:37 UTC

A disposable clone combined THI-19 `5f83b97`, latest main `0f9b1a5` (PR #25), and THI-28 `ee564f674fe941b16eda06a11df821fe5753c445` (PR #26), plus the adapter compatibility and process-group changes in this update. This is validation composition, not a merge of either GitHub PR.

- Strict typecheck passed after Kiro explicitly declared pause and waiting input unsupported. Focused combined runtime/scheduler/input/Kiro suites passed 35 tests.
- Kiro CLI updated to 2.28.0 and was initially signed out. After the user authenticated it, the native multi-step journey passed with **zero settling delay**: same-candidate overlapping reviews, selected check retry only, current validation, explicit acceptance and stale rejection. Configured ticket retrieval used a fixture, explicitly identified in the receipt. See `thi19-combined-native-journey-proof-2026-10-06.json`.
- Fresh Codex 0.160.0 native proof passed authentication, streaming, stable identity, project edit, guidance, reconnect, controlled failure and selected retry. See `thi19-combined-codex-proof-2026-10-06.json`.
- Native Kiro cancellation first exposed a live engine child surviving launcher termination. The adapter now owns a POSIX process group and signals the whole group on abort, close and stream cleanup; Windows falls back to direct child termination. Fresh native proof recorded launcher and engine PIDs before cancellation, no matching PIDs afterward, and stream termination. See `thi19-combined-kiro-cancel-proof-2026-10-06.json`. Fixture tests cover a nested process and the Windows fallback; no native Windows claim is made.
- Built and packed the combined candidate; production-only consumer install succeeded. Tarball SHA-256: `f97978ddeadb2bfb979dc4dde39729a659ec983b42263ca0521c86515372b242`.
- Packed Chrome fixture browser tests passed setup/model verification, keyboard drawer focus/Escape restoration, published loop, configured ticket intake, parallel reviews, queued guidance, file inspection, fresh evidence and explicit acceptance; a separate selected failed-review retry passed. Provider and tracker fixtures are not native browser proof.
- At 390 × 844, reduced-motion media emulation matched and shared button computed transition property was `none`. The inspected screenshot is `thi19-packed-mobile-reduced-motion-2026-10-06.png`.
- Mobile keyboard acceptance remains **failed**: Space → ArrowDown → Enter on the default-model native select submits setup asynchronously; waiting for network idle reveals that the selector disappeared. An earlier immediate focus assertion falsely passed before the rerender. Trace retained at `/tmp/thi19-combined-VcZH0K/packed-mobile-keyboard-failure.zip`; UI agent owns the repair. Full final browser/accessibility acceptance must be repeated after that repair and final branch composition.

Combined full Vitest run passed 25 suites /166 tests; the additional Windows-fallback test passed in the final focused Kiro suite (7 tests). The final combined typecheck passed before that additional test, and the updated test also typechecks against the original candidate.

Final THI-19 branch checks after the process-group repair passed `pnpm check` (24 suites /158 tests), `pnpm test:package`, and `git diff --check`. UI agent reports the mobile Enter repair in PR #27 `cc826ae` passed 10/10 on its branch and 10/10 on its disposable integration; that repair is not included in the packed artifact identified above, so this receipt retains its mobile failure truthfully.
