# Foundation decisions

## Distribution and development

Ship one npm package containing the Node CLI/runtime and built static React UI. Use pnpm for development, Vite's official React plugin and Tailwind integration for the UI, and TypeScript for strict checking and Node output. Avoid adding a second bundler before the small CLI needs one. Build artifacts are generated under `dist/node` and `dist/ui`; UI build dependencies do not need to be installed by package consumers.

## Portable domain ownership

Factory definitions belong to `.code-factory`. Agent-native files are import/export representations handled through a separate translator. Existing `.kiro`, `.cursor`, `.claude`, and project instruction files remain user-owned. Translators must report unsupported or lossy fields, preview changes, and preserve existing content. No translator is implemented in this foundation.

The initial versioned schema describes agent/check steps, explicit dependency edges, separate canvas positions, execution bindings, output declarations, retry limits, and total implementation-round limits. The two-round advanced policy means initial implementation plus one repair. It does not mean two additional repairs. Arbitrary cycles are invalid. Structured repeat containers, joins, decisions, check commands, and evidence contracts need a reviewed schema extension before full MVP graph execution. Policy fields alone do not implement repair scheduling.

Keep roles/instructions independent of provider/model bindings. Resolve defaults into a run snapshot once. Published definitions and historical inputs must be immutable in the future persisted registry; detached in-memory copies are only the starting contract.

## Execution ownership — provisional

Code Factory owns the portable loop scheduler. Adapters execute assigned steps and translate observable provider events. Do not simultaneously schedule the same graph through a native workflow runner. Delegated native workflow execution would be a distinct mode with explicit ownership.

This choice supports the new portable-factory requirement, but remains provisional until THI-6 proves the first supported runtime integration. This foundation deliberately does not implement the production scheduler. Native subagents inside an assigned step remain provider behavior and do not automatically become factory graph nodes.

## Connection truthfulness

An executable candidate is not an authenticated or supported connection. Discovery performs no agent launch and reads no credentials. Identity/version verification, supported interfaces, authentication, advertised capabilities, and model catalogs must be proved by each runtime adapter. Generic executable names such as `agent` need particular care during verification. UI controls consume capabilities, rather than assuming parity from brand names. Custom connections will require explicit executable and protocol configuration.

The mock emits started/message/completed events and supports cancellation. It declares no steering or resume. A successful mock step means only that the fixture completed; it creates no source edits or test evidence.

## Local runtime and UI state

Bind to loopback and serve the packaged UI from its installed directory, independent of the user's project directory. Reject foreign Host/Origin headers and unsupported mutations. Filesystem paths come from the CLI-selected workspace, rather than arbitrary browser input. Future mutation endpoints require explicit validation, ownership, and concurrency controls.

Keep local React state near its components. Use reducers for complex editor transitions; add server-state caching when runtime endpoints exist. The backend's durable run state will remain authoritative. Do not duplicate execution ownership in UI state or simulate model acknowledgment without an actual provider reply.

## Next slices

1. THI-6: prove a native adapter using supported interfaces and record actual steering, streaming, session, retry, and recovery behavior.
2. Extend portable loop and event schemas for scheduling, evidence, attempt identity, bounded repair groups, and persistence.
3. Implement the durable description-only mock vertical slice, then use the same contracts for the native adapter.
4. Integrate approved Figma screens with shadcn components, onboarding, empty states, and explicit optional templates.

This change advances THI-7/THI-8; it does not complete either issue's full acceptance criteria.
