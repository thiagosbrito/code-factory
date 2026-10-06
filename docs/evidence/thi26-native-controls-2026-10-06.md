# THI-26 native control verification (2026-10-06)

## Provider and protocol

- Installed provider: `codex-cli 0.160.0`.
- Generated bindings with `codex app-server generate-ts --out /tmp/thi26-protocol --experimental`.
- The generated `ClientRequest` union contains `turn/start`, `turn/steer`, and `turn/interrupt`. It contains no `turn/pause` or `turn/resume` request. `thread/resume` resumes a thread connection, not a paused active turn. `turn/interrupt` interrupts a turn and is not pause/resume evidence. Active-turn pause and resume remain unsupported for this provider version.
- The generated `ServerRequest` union contains `item/tool/requestUserInput`. Its request parameters include `threadId`, `turnId`, `itemId`, `questions`, `isBlocking`, and `autoResolutionMs`. The generated response has `answers` keyed by question ID. These schema fields do not establish how a Code Factory step waits, times out, cancels, or recovers after restart.

## Live request/reply probe

A disposable native app-server probe was prepared in `/tmp/thi26-input-probe.mjs`. It initializes an app-server process, starts a thread and plan-mode turn in a temporary Git repository, asks for one `request_user_input` question, and sends a JSON-RPC reply using the server request ID and question ID. It records the turn and item IDs, request, reply, and completion events if reached. No application files or credentials are copied into the probe.

Inside Symphony's worker sandbox, the installed app-server exits with code 1 during `initialize`, before `thread/start` or `turn/start`. Stderr is:

```text
WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)
Error: Operation not permitted (os error 1)
```

`codex login status` reports `Logged in using ChatGPT`. The probe was repeated with `sqlite_home` and `log_dir` directed to its temporary writable directory; the same error occurred in that sandbox.

On the subsequent THI-26 attempt, the same disposable probe was run again in the worker sandbox. It still exited during `initialize` with the same `Operation not permitted` error, so no new native timeout, cancellation, or restart observation was possible there.

The same disposable probe was rerun outside the worker sandbox on 2026-10-06 with `initialize.capabilities.experimentalApi: true`. Initialization, `thread/start`, and `turn/start` succeeded. The app-server sent a blocking `item/tool/requestUserInput` with request ID `0`, thread ID `01a1103c-b218-7341-87f1-57f3bc918be8`, turn ID `01a1103c-b29b-7f51-973b-a8cc12d6ba37`, item ID `call_8fQ2HVfishlrX09GcycuMgKN`, and question ID `reply_style`. The probe replied to request ID `0` with an answer keyed by `reply_style`. The turn completed successfully with the final message `You chose a concise final reply.` The scoped receipt is `thi26-request-user-input-proof-2026-10-06.json`. This proves a live correlated request/reply, but does not yet prove timeout, cancellation, or restart behavior.

## Product consequence and remaining proof

The verified request/reply uses the JSON-RPC server request ID together with the thread, turn, item, and question IDs. The candidate adapter records those identities and only replies through the native server-request response. Ordinary guidance remains queued while the attempt waits and is never used as a prompt answer. Pause/resume remains unsupported; `turn/interrupt` is cancellation, not pause.

Two further unrestricted disposable probes are recorded in `thi26-native-cancel-restart-proof-2026-10-06.json`. Interrupting a turn while a blocking input request was pending returned an interrupted turn completion without sending an answer. Killing the app-server while a different request was pending, then resuming its thread from a new app-server, returned an idle thread with the prior turn interrupted; the request was not replayed. A pending input reply therefore cannot survive that process restart. The candidate must report this as interrupted or failed and require a new attempt, rather than show a usable old prompt.

`autoResolutionMs` is exposed by the protocol, but the live requests had a null value. No native auto-resolution or deadline has been observed; timeout behavior must not be claimed as supported from the protocol field alone. Cancellation and process-restart provider behavior are now observed. Candidate integration, stale-attempt rejection after those boundaries, and final validation remain before publication. The worker sandbox cannot initialize the app-server, so these final native checks must run outside that sandbox.
