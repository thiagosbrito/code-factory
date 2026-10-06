# THI-19 packaged browser and native run observation, 2026-10-06

This is a partial release receipt from an unrestricted disposable Git project using the current uncommitted `symphony/THI-19` candidate. It is not the final acceptance receipt.

## Observed in the packaged UI

- Started `dist/node/cli.js` against a clean project without consumer frontend build dependencies. Blank onboarding showed no runs. Settings detected Codex and Kiro, while Cursor and Claude Code remained unavailable.
- Selected Kiro, verified its authenticated connection, and observed Streaming **Available**, Guidance **Unsupported**, Recovery **Unsupported**, and project default `kiro · agent-default`.
- Created an empty loop draft, edited its title and agent instruction, saved it, and published immutable version 1. Started a description-only run from that version. The run intake required a Git repository with an initial HEAD before it could capture a baseline; after initializing and committing the disposable project, the run was created.
- Executed run `b51ccbea-a5b1-46a6-aff8-17d33608823c`. The graph changed from pending to running to succeeded with one attempt. The Kiro step wrote `proof.txt` containing `browser-proof`. The Activity inspector displayed lifecycle, tool, and streamed message events. Files showed the current added-file receipt and exact read-only diff; Details showed the immutable loop version, baseline, candidate/input hashes, and current provenance. Step guidance was disabled with an explicit unsupported message.
- The final evidence panel truthfully kept local validation **Incomplete** and human acceptance **pending** because this one-step loop contained no validation checks or reviews.
- Reloaded the browser and restarted the local service at the same URL. The completed run and its single attempt remained visible; no work was relaunched. Browser diagnostics contained no warnings or errors.
- At a 390 × 844 viewport, the step inspector, tabs, details, graph, and evidence panel remained readable. Keyboard Enter on the focused graph node reopened the inspector; Escape closed it and returned focus to the node.
- Source inspection found only button color transitions in this UI. The candidate now adds `motion-reduce:transition-none` to that shared button style; generated CSS and an emulated reduced-motion browser state still need final verification.

## Remaining release checks

The configured ticket intake, parallel review, guidance, selected retry, stale-evidence rejection, second-round success/abort, and explicit acceptance paths have fixture coverage but not one fresh combined native browser journey on this candidate. Perform those checks, verify reduced-motion output and final candidate identity, rerun required checks, then publish and review the implementing PR.
