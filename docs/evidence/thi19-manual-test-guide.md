# THI-19 manual test guide

Use this guide against the uncommitted `symphony/THI-19` candidate. It is a test plan, not an acceptance receipt. Record the candidate commit and any uncommitted changes before starting. Run tests in a disposable project; do not point the CLI at this repository. Stop after the first blocker and report it rather than repeating paid agent work.

## 1. Prepare one disposable packaged installation

Prerequisites: Node 22.12 or newer, pnpm 11.8.0, npm, Git, a browser, and authenticated Codex and Kiro CLIs for the native checks. In a terminal, change to the THI-19 code-factory checkout (`/Users/thiagosbrito/personal/code-factory-automation/workspaces/THI-19`) and run the entire command block there. The commands use absolute paths for the disposable consumer and project. Keep the same terminal open so `THI19_TEST` remains set.

```sh
cd /Users/thiagosbrito/personal/code-factory-automation/workspaces/THI-19
git rev-parse HEAD
git status --short
THI19_TEST=$(mktemp -d)
npm pack --pack-destination "$THI19_TEST"
shasum -a 256 "$THI19_TEST/code-factory-0.1.0.tgz"
mkdir -p "$THI19_TEST/consumer" "$THI19_TEST/project/.kiro"
npm install --prefix "$THI19_TEST/consumer" "$THI19_TEST/code-factory-0.1.0.tgz" --omit=dev
printf 'keep me\n' > "$THI19_TEST/project/.kiro/existing.txt"
printf '# THI-19 disposable project\n' > "$THI19_TEST/project/README.md"
git -C "$THI19_TEST/project" init
git -C "$THI19_TEST/project" add README.md .kiro/existing.txt
git -C "$THI19_TEST/project" -c user.name='THI-19 Test' -c user.email='thi19@example.invalid' commit -m 'Disposable baseline'
"$THI19_TEST/consumer/node_modules/.bin/code-factory" init "$THI19_TEST/project"
cat "$THI19_TEST/project/.kiro/existing.txt"
"$THI19_TEST/consumer/node_modules/.bin/code-factory" start --project "$THI19_TEST/project" --port 0
```

Open the URL printed by `start`. Keep that terminal open. Expected: npm installs without any frontend build dependency in the consumer; `init` reports no agent, model, or loop selected; `existing.txt` still says `keep me`; the blank factory has no runs. A repeat `init` should reject the already initialized project. `npm pack` builds the current working files, including uncommitted source changes, once through its prepack script. It does not commit or reset them; its build script only replaces generated `dist`. Save the tarball SHA-256 with your report because the commit alone does not identify an uncommitted candidate. If source files change after packing, repack before continuing. Do not run `pnpm check` just to follow this guide; the latest candidate already passed it.

## 2. Free browser and setup checks

Check these before triggering any agent run. Record a screenshot only where the result differs from expected.

- In first-use setup, enter a project display name. Check that agent discovery distinguishes **detected** from **verified**. Select Kiro and choose **Verify connection**; if the CLI is signed in, it should show Streaming available, Guidance unsupported, Recovery unsupported. Save the project with Agent default or a listed model. A model listed in the catalog may still fail at execution if the account lacks entitlement.
- In Settings, check the saved default and available models. Codex should be independently verifiable. Cursor and Claude Code may be detected but are discovery-only. A custom executable supports only the verified Codex app-server protocol.
- In Loops, create an empty loop draft. Rename it, add an agent step in Implementation, open its configuration drawer, change the title and instructions, close it, save the draft, then publish v1. Check the library shows an immutable published version. Also use **Export JSON**, then **Import JSON** and preview the exported file. Import should create a separate draft rather than replace the published version.
- In the editor's **Native configuration translation** section, choose the offered Cursor project-rule format. Preview before applying import/export. The preview must name the affected path, conflicts, and unsupported or lossy fields. An unchanged native file should remain unchanged when an operation is rejected. Do not assume this enables Cursor execution.
- Keyboard: Tab through setup, sidebar, Loops and editor controls. Open a step drawer with Enter; focus should move into it, Tab should stay in the drawer, and Escape should close it and return focus to the trigger. In **New run**, focus should begin at Ticket number; Escape should close the dialog and restore focus. On a run graph, Enter should open the inspector; Arrow keys should move between its tabs; Escape should close it and restore focus. Inspect Files and Artifacts by keyboard; they must remain read-only.
- At a 390 × 844 browser viewport, inspect the sidebar, editor, graph, inspector, and final evidence panel for clipped controls or unreadable text. Enable the OS/browser **Reduce motion** setting and repeat navigation; button transitions should stop. Status must be understandable from text as well as color.

## 3. One small native run per provider

Use a harmless task such as `Create proof.txt containing exactly THI-19 test`. Native calls may consume provider quota. Create a published loop with one Implementation agent step; keep its instruction narrow and its expected output as `proof.txt`. Make a **description-only** run. Creating the run should leave it pending and should not call the agent. Record the run ID, then choose **Execute run** once. Expected: pending → running → succeeded; one attempt; `proof.txt` appears in the run's read-only Files diff and provenance. The original disposable project's working tree should not be modified by the run. The final evidence panel should say **Incomplete** because this loop has no validation step; **Accept evidence** should be unavailable.

While the completed run is displayed, reload the browser. Record the attempt count. Stop the local service with Ctrl+C, restart it with the same `start --project ... --port 0` command, and open its newly printed URL. The completed run and attempt count should persist; no agent work should start automatically. Reverify the agent connection after service restart. For an active run interrupted by service restart, do not expect Kiro recovery: the UI should say it is interrupted/unavailable without silently starting paid work again. Codex recovery is supported only where the adapter reports it.

Repeat the **same published loop and task text** with Codex as the verified project default, then with Kiro, using a new run each time. Leave the loop step without an explicit provider binding so each new run resolves the current project default; check the binding shown in each run snapshot before execution. Record provider, CLI version, selected model, run ID, attempt count, status, and whether lifecycle/tool/message events and the same file output appeared. Codex supports guidance and recovery; Kiro currently does not. Do not interpret these differences as a layout change or as proof that Cursor/Claude Code execute.

## 4. Remaining full-journey checks

These require more native calls. Run them only after sections 1–3 pass. Use a disposable ticket and keep agent instructions short. Mark a path **blocked/not reproducible** if there is no safe deterministic way to trigger it; do not repeatedly spend quota.

1. **Configured ticket intake:** Set `CODE_FACTORY_LINEAR_API_KEY` in the service process environment using your own test token; never paste the token into a report. Restart the service, open **New run**, enter a test ticket ID and **Retrieve**. Check title/summary/attachments, create the run, and confirm the run snapshot keeps the retrieved ticket. Clear the ticket and confirm description-only intake still works. Without a token, record this path as blocked by tracker configuration.
2. **Parallel review:** In a new loop draft add one Implementation step, two Review agent steps, and one Validate check step. Connect the implementation to both reviews, make a parallel group of the reviews, then join both into validation with **all** mode. Keep reviewer instructions to a verdict on the small `proof.txt` change. Publish and run once. Check two separate review attempts inspect the same candidate and their receipts identify that candidate. A failed publish with a clear graph validation message is preferable to guessing connections.
3. **Guidance:** During a running Codex step, open that exact attempt's inspector and queue a short message. Look for queued → delivered or a truthful undelivered state tied to the same attempt. On Kiro the guidance control must remain disabled and say unsupported. If the Codex step ends before the message can be sent, record **not observed**, not a pass.
4. **Selected retry and freshness:** Use a disposable loop with a Validate check whose command is `test -f /absolute/path/to/your/disposable/retry-pass`. Choose a unique path outside the project and confirm the file is absent. The first check should fail without modifying the source candidate. A failed run should offer **Retry…** only on its latest failed attempt. Read the dialog's retained evidence and revalidation list. Create that marker file, then retry the selected check once; earlier attempts and logs should remain inspectable, with a new attempt ID. If an upstream implementation is rerun or its candidate changes, downstream check/review receipts must become stale; **Accept evidence** must not appear until fresh checks and reviews pass for the new candidate. Do not edit run history files to simulate freshness.
5. **Second round and abort:** Use a bounded repeat loop or the staged starter template only if quota permits; the staged template has six reviews and can be expensive. Observe one repair decision leading to round 2, then either a pass with fresh receipts or a terminal failure when the round limit is exhausted. Record which branch actually occurred. Do not claim both outcomes from a single run.
6. **Explicit acceptance:** On a genuinely succeeded run with current passing validation/review receipts, check **Local validation: Passed** and **Human acceptance: Pending**. Choose **Accept evidence** once. It should become accepted with a timestamp. A later candidate change should invalidate current acceptance while retaining the earlier acceptance receipt in history.

## 5. Report back

Send a short report even if you stop early. Include exact messages and screenshots for failures. Redact tokens and private project content.

```text
Candidate: git commit ..., git status --short ..., tarball SHA-256 ...
Host: OS ..., Node ..., browser ..., Codex CLI ..., Kiro CLI ...
Section/step: ...
Result: pass | fail | blocked | not observed
Expected: ...
Actual: ...
Run ID / loop version / step and attempt ID: ...
Exact UI or terminal error: ...
Screenshot or redacted log: ...
Did an agent call start? How many attempts before/after? ...
```

Already recorded for this candidate: packaged install/blank init, a small Kiro browser run and restart, native Codex/Kiro one-step contract receipts, and automated fixture tests. The combined configured-ticket → parallel review → guidance → retry → fresh evidence → acceptance journey and complete accessibility pass still need human/browser evidence. Registry publication and deployment are separate release actions.
