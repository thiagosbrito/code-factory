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
