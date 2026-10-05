# Foundation decisions

## Distribution and development

Ship one npm package containing the Node CLI/runtime and built static React UI. Use pnpm for development, Vite's official React plugin and Tailwind integration for the UI, and TypeScript for strict checking and Node output. Avoid adding a second bundler before the small CLI needs one. Build artifacts are generated under `dist/node` and `dist/ui`; UI build dependencies do not need to be installed by package consumers.

## Portable domain ownership

Factory definitions belong to `.code-factory`. Agent-native files are import/export representations handled through a separate translator. Existing `.kiro`, `.cursor`, `.claude`, and project instruction files remain user-owned. Translators must report unsupported or lossy fields, preview changes, and preserve existing content. No translator is implemented in this foundation.

The V2 portable schema describes agent/check steps, explicit dependency edges, semantic parallel/repeat groups, joins, decisions, separate canvas positions, execution bindings, output declarations, retry limits, and total implementation-round limits. Repeat groups require a bounded iteration count, an exit branch outside the group, and a distinct continuation branch into the group. The continuation is a semantic back edge; ordinary dependency cycles remain invalid. The two-round advanced policy means initial implementation plus one repair. It does not mean two additional repairs. Policy fields alone do not implement repair scheduling.

Keep roles/instructions independent of provider/model bindings. Resolve defaults into a run snapshot once. The local registry stores drafts at `.code-factory/loops/<id>/draft.json`, immutable numbered publications at `versions/<version>.json`, and runs at `.code-factory/runs/<run-id>.json`. A publication advances the editable draft to the next version. Invalid imports and corrupt files fail with their path and validation details rather than resetting saved data. V1 loop and detached run snapshots migrate to V2 on parse; no previous persisted run format existed.

Run records retain detached task, loop/version, project default, per-step resolved bindings and baseline identity. Every run, step instance, attempt and implementation round has a durable UUID. Sibling steps have separate status and attempt histories. Retrying a step increments its attempt number without advancing the implementation round; repair appends a round record explicitly. Native session and turn resume handles may be attached once to a running attempt. Evidence entries define events, guidance, checks, reviews, outputs, files and artifacts with provenance and candidate freshness. Guidance transitions can append receipts sharing a message ID. File and artifact references use validated project-relative paths. The storage layer enforces immutable snapshot identity, append-only evidence, revision checks and retained attempt and round identities. The scheduler claims ready steps before launching an adapter, records native session IDs and events, and persists separate candidate and input hashes.

Public events have contiguous per-run sequence numbers and retain their step, attempt, session and turn identity. Cursor replay and server sent events read the persisted run record, so closing a browser subscription does not control execution. Agent messages, supported public tool output, local checks and lifecycle changes are separate event types. Native reasoning notifications are excluded. A transport error after launch leaves an interrupted attempt and an unavailable run instead of inventing a provider failure. After service restart, a run with a persisted completion event can settle that attempt. An active native attempt can reattach only when its adapter declares verified resume support and has durable session and turn handles. Check processes and review workspaces that did not persist completion cannot resume. Unsupported or uncertain recovery records an interruption and never starts another paid attempt automatically. Historical attempts and queued guidance remain append-only.

## Execution ownership — confirmed for the first adapter (THI-6)

Code Factory owns the portable loop scheduler. The Codex adapter starts one app-server thread and turn for one assigned step; retry starts a separate thread for that step and attempt. The adapter does not submit a graph to a native workflow runner. Do not simultaneously schedule the same graph through a native workflow runner. Delegated native workflow execution would be a distinct mode with explicit ownership.

The fixture validates this ownership and preserves run, step, attempt, thread, and turn identities on every portable event. The scheduler uses the same adapter contract for mock and verified native turns; run updates store event, check, and review receipts before moving to dependent work. Native subagents inside an assigned step remain provider behavior and do not automatically become factory graph nodes.

## First native adapter proof boundary

Codex CLI 0.160.0 is the first candidate. Its locally generated app-server protocol schema includes `initialize`, `account/read`, `model/list`, `thread/start`, `turn/start`, `thread/resume`, `thread/read`, and `turn/steer`. The adapter uses JSON-RPC over a private stdio process. `item/agentMessage/delta` and `turn/completed` become portable step events. `turn/steer` uses the expected active turn ID and never calls `turn/interrupt`. The native process owns credentials; connection inspection returns only an authentication state and a display catalog. A catalog entry is not proof of entitlement to run that model. The factory does not read or export credential files.

Kiro CLI 2.27.0 remains a second-provider candidate. Its documented ACP interface includes initialize, session creation/load, prompt, cancel, model selection, and streaming notifications. The documented ACP method list does not establish cooperative in-flight guidance, so Kiro steering remains unknown pending a separate probe. See [Kiro ACP](https://kiro.dev/docs/cli/acp/) and [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

A host-authorized disposable-project proof on 2026-10-03 completed with Codex CLI 0.160.0 and `gpt-6-sol`. The [native receipt](evidence/thi6-native-2026-10-03.json) records authenticated catalog inspection, actual text-file edits, started/message/completed events with stable identities, a `turn/steer` acknowledgment plus the requested file, completed-turn recovery after a new app-server connection, and a selected retry on a distinct thread after an intentionally unavailable model produced a native error. No `turn/interrupt` was sent. Factory scheduling remains the sole graph owner.

The proof exposed two integration gaps: incoming server requests were discarded as responses, and the turn lacked explicit writable roots. The adapter now supplies its assigned project root with native tool network access disabled, declines command approvals, and rejects unsupported server requests. A host may supply an explicit file-change decision callback; the proof accepts only patches to its three allowlisted disposable files. Production UI approval handling is still a separate integration task. Connection capability declarations remain `unknown` until connection-specific evidence is verified; this one host receipt is not a blanket claim for every executable, account, model, or machine.

Run `pnpm prove:codex` only with explicit native launch intent. It makes bounded real model calls, uses Codex-owned authentication, preserves the disposable project and receipt for inspection, and exits nonzero if any required check fails. The initial pre-initialize sandbox failure is historical; it no longer describes the current host after the runtime permissions were granted. Fixture tests remain separate from the native receipt. [Supported app-server lifecycle and approvals](https://learn.chatgpt.com/docs/app-server).

## Connection truthfulness

An executable candidate is not an authenticated or supported connection. Discovery performs no agent launch and reads no credentials. Identity/version verification, supported interfaces, authentication, advertised capabilities, and model catalogs must be proved by each runtime adapter. Generic executable names such as `agent` need particular care during verification. UI controls consume capabilities, rather than assuming parity from brand names. Custom connections will require explicit executable and protocol configuration.

The connection registry now launches Codex only after an explicit local verification request. A custom path uses the same supported Codex app-server protocol and must pass executable, identity, and inspection checks; a saved path by itself never becomes a connection. The runtime keeps verified sessions in memory and stores only project defaults and optional custom executable configuration. Catalog choices are validated at save time. Previously saved unavailable selections remain visible in the UI and cannot silently become another model. Per-step binding selectors are exported for the loop editor; run snapshots continue to resolve bindings once at creation.

The mock emits started/message/completed events and supports cancellation. It declares no steering or resume. A successful mock step means only that the fixture completed; it creates no source edits or test evidence.

## Local runtime and UI state

Run intake uses the CLI-selected project only. It reads an actual immutable published loop version, checks every resolved binding against the current verified connection catalog, retrieves ticket material on the server when requested, and writes a pending run with the returned UUID as an idempotency key. A repeated request with that UUID returns the saved run; a changed payload conflicts. No scheduler starts at intake time.

Git baselines are isolated by cloning the selected repository into `.code-factory/workspaces/<uuid>`, checking out the captured HEAD, then overlaying staged, unstaged, deleted, and untracked files. The clone records that state as a local baseline commit; the snapshot retains both its revision and the source HEAD. The clone receives its own Git metadata, so concurrent writing runs do not share a worktree or index. The original project remains untouched. Factory metadata is excluded from the source overlay. Non-Git projects cannot start a writing run. The scheduler executes inside the snapshot workspace and retains it after success, failure, or rejection. Reviewers execute in temporary copies so their writes cannot change another reviewer's candidate or the writer's workspace.

Bind to loopback and serve the packaged UI from its installed directory, independent of the user's project directory. Reject foreign Host/Origin headers and unsupported mutations. Filesystem paths come from the CLI-selected workspace, rather than arbitrary browser input. Future mutation endpoints require explicit validation, ownership, and concurrency controls.

Keep local React state near its components. Use reducers for complex editor transitions; add server-state caching when runtime endpoints exist. The backend's durable run state will remain authoritative. Do not duplicate execution ownership in UI state or simulate model acknowledgment without an actual provider reply.

The loops library reads saved drafts and the latest publication from the local registry. The five-stage board is a view of portable steps; `stage` and canvas coordinates do not grant execution order. Explicit before/after targets change dependency edges, while group, join, and decision controls change their corresponding portable structures. The editor keeps immutable undo/redo states, saves drafts through the runtime, and validates publication against current connection catalogs and project defaults. Publications stay numbered and immutable; later edits target the next draft version. Optional templates and import/export are owned by THI-18.

## Next slices

1. Consume the THI-6 native receipt when integrating connection verification, scoped approval UI, and the production runner; rerun the proof for a different native environment.
2. Extend portable loop and event schemas for scheduling, evidence, attempt identity, bounded repair groups, and persistence.
3. Implement the durable description-only mock vertical slice, then use the same contracts for the native adapter.
4. Integrate approved Figma screens with shadcn components, onboarding, empty states, and explicit optional templates.

This change advances THI-7/THI-8; it does not complete either issue's full acceptance criteria.
