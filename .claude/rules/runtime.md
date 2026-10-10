---
paths:
  - "src/runtime/**/*.ts"
---

# Runtime rules

- Treat durable runtime state as authoritative. Keep persistence, scheduling,
  intake, events, trust, Git operations, and provider coordination separate.
- Parse API, disk, configuration, tracker, and provider data at their boundary.
  Corrupt persisted data must produce a useful error and must never be silently
  reset.
- Preserve revision checks, contiguous event sequence numbers, idempotent
  intake, append-only evidence, and serialized commits to a run record.
- Keep the scheduler as the sole graph owner. Adapters execute one assigned
  step and report events; they do not advance the graph.
- Preserve explicit project trust and tool grants. Never expose credentials in
  project data or API responses, and remove sensitive runtime environment
  values before child processes can inherit them.
- Keep mutating Git commands in the `run-branch*.ts` modules. Do not stash,
  reset, clean, force-switch, alter Git configuration, reuse an existing run
  branch, or push. Preserve the user's checkout, index, and files on failure.
- Keep local HTTP access session-protected and loopback-only. Maintain Host,
  Origin, CSP, and mutation validation when changing server behavior.
- Add runtime and persistence tests with disposable projects. Exercise failure,
  retry, restart, concurrency, trust, and preservation paths when relevant.
