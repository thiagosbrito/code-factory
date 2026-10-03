# Foundation decisions

## Distribution and development

Ship one npm package containing the Node CLI/runtime and built static React UI. Use pnpm for development, Vite's official React plugin and Tailwind integration for the UI, and TypeScript for strict checking and Node output. Avoid adding a second bundler before the small CLI needs one. Build artifacts are generated under `dist/node` and `dist/ui`; UI build dependencies do not need to be installed by package consumers.

## Portable domain ownership

Factory definitions belong to `.code-factory`. Agent-native files are import/export representations handled through a separate translator. Existing `.kiro`, `.cursor`, `.claude`, and project instruction files remain user-owned. Translators must report unsupported or lossy fields, preview changes, and preserve existing content. No translator is implemented in this foundation.

The V2 portable schema describes agent/check steps, explicit dependency edges, semantic parallel/repeat groups, joins, decisions, separate canvas positions, execution bindings, output declarations, retry limits, and total implementation-round limits. Repeat groups require a bounded iteration count, an exit branch outside the group, and a distinct continuation branch into the group. The continuation is a semantic back edge; ordinary dependency cycles remain invalid. The two-round advanced policy means initial implementation plus one repair. It does not mean two additional repairs. Policy fields alone do not implement repair scheduling.

Keep roles/instructions independent of provider/model bindings. Resolve defaults into a run snapshot once. The local registry stores drafts at `.code-factory/loops/<id>/draft.json`, immutable numbered publications at `versions/<version>.json`, and runs at `.code-factory/runs/<run-id>.json`. A publication advances the editable draft to the next version. Invalid imports and corrupt files fail with their path and validation details rather than resetting saved data. V1 loop and detached run snapshots migrate to V2 on parse; no previous persisted run format existed.

Run records retain detached task, loop/version, project default, per-step resolved bindings and baseline identity. Every run, step instance, attempt and implementation round has a durable UUID. Sibling steps have separate status and attempt histories. Retrying a step increments its attempt number without advancing the implementation round; repair appends a round record explicitly. Native session and turn resume handles may be attached once to a running attempt. Evidence entries define events, guidance, checks, reviews, outputs, files and artifacts with provenance and candidate freshness. Guidance transitions can append receipts sharing a message ID. File and artifact references use validated project-relative paths. The storage layer enforces immutable snapshot identity, append-only evidence, revision checks and retained attempt and round identities. Scheduler execution, live event capture and UI wiring belong to subsequent tickets.

## Execution ownership — confirmed for the first adapter (THI-6)

Code Factory owns the portable loop scheduler. The Codex adapter starts one app-server thread and turn for one assigned step; retry starts a separate thread for that step and attempt. The adapter does not submit a graph to a native workflow runner. Do not simultaneously schedule the same graph through a native workflow runner. Delegated native workflow execution would be a distinct mode with explicit ownership.

The fixture validates this ownership and preserves run, step, attempt, thread, and turn identities on every portable event. The production scheduler and durable receipt journal remain future work. Native subagents inside an assigned step remain provider behavior and do not automatically become factory graph nodes.

## First native adapter proof boundary

Codex CLI 0.160.0 is the first candidate. Its locally generated app-server protocol schema includes `initialize`, `account/read`, `model/list`, `thread/start`, `turn/start`, `thread/resume`, `thread/read`, and `turn/steer`. The adapter uses JSON-RPC over a private stdio process. `item/agentMessage/delta` and `turn/completed` become portable step events. `turn/steer` uses the expected active turn ID and never calls `turn/interrupt`. The native process owns credentials; connection inspection returns only an authentication state and a display catalog. A catalog entry is not proof of entitlement to run that model. The factory does not read or export credential files.

Kiro CLI 2.27.0 remains a second-provider candidate. Its documented ACP interface includes initialize, session creation/load, prompt, cancel, model selection, and streaming notifications. The documented ACP method list does not establish cooperative in-flight guidance, so Kiro steering remains unknown pending a separate probe. See [Kiro ACP](https://kiro.dev/docs/cli/acp/) and [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

The sandboxed disposable-project probe of `codex app-server --listen stdio://` exited with `Operation not permitted` before `initialize` returned. Consequently the current machine has no live turn, streaming, retry, recovery, or steering receipt. Connection capabilities remain `unknown` in the adapter until those behaviors are exercised through an explicitly authorized real task. Before release, run the same portable contract against a disposable project in an environment where app-server can start, with explicit user launch intent; capture the started, delta, completed, failed retry, resumed, and steering acknowledgments and verify the project diff. The deterministic fixture proves translation and control routing, not native execution.

## Connection truthfulness

An executable candidate is not an authenticated or supported connection. Discovery performs no agent launch and reads no credentials. Identity/version verification, supported interfaces, authentication, advertised capabilities, and model catalogs must be proved by each runtime adapter. Generic executable names such as `agent` need particular care during verification. UI controls consume capabilities, rather than assuming parity from brand names. Custom connections will require explicit executable and protocol configuration.

The mock emits started/message/completed events and supports cancellation. It declares no steering or resume. A successful mock step means only that the fixture completed; it creates no source edits or test evidence.

## Local runtime and UI state

Bind to loopback and serve the packaged UI from its installed directory, independent of the user's project directory. Reject foreign Host/Origin headers and unsupported mutations. Filesystem paths come from the CLI-selected workspace, rather than arbitrary browser input. Future mutation endpoints require explicit validation, ownership, and concurrency controls.

Keep local React state near its components. Use reducers for complex editor transitions; add server-state caching when runtime endpoints exist. The backend's durable run state will remain authoritative. Do not duplicate execution ownership in UI state or simulate model acknowledgment without an actual provider reply.

## Next slices

1. THI-6: finish the live disposable-project proof after an explicit launch and app-server access are available.
2. Extend portable loop and event schemas for scheduling, evidence, attempt identity, bounded repair groups, and persistence.
3. Implement the durable description-only mock vertical slice, then use the same contracts for the native adapter.
4. Integrate approved Figma screens with shadcn components, onboarding, empty states, and explicit optional templates.

This change advances THI-7/THI-8; it does not complete either issue's full acceptance criteria.
