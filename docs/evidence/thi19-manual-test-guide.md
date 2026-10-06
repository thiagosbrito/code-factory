# THI-19 manual test guide

This guide has two parts. A technical helper runs the commands in section 1. Anyone testing the screens can start at section 2. The test project is separate from the code-factory source. Stop at the first problem and report it; do not repeat an agent run just to gather more information.

## 1. Prepare one disposable packaged installation

**For the technical helper.** You need Node 22.12 or newer, pnpm 11.8.0, npm, Git, and a browser. Codex and Kiro must be installed and signed in for their agent tests. Run this block in one terminal. It begins by changing to the THI-19 checkout. Do not close this terminal while testing.

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

After the last command, the terminal should show a line like `Code Factory: http://127.0.0.1:12345`. That address is the next step. The number will be different on your computer. The terminal must stay open because it runs the local service.

Before handing off to a screen tester, check these results:

1. `npm install` finished without an error. The consumer did not need a separate frontend build.
2. `init` said it selected no agent, model, or loop.
3. `cat` printed `keep me`. This shows an existing agent file was preserved.
4. Save the SHA-256 printed by `shasum`. It identifies the exact package tested. The Git commit alone does not identify uncommitted work.

The package contains the current uncommitted source changes. Packing does not commit or reset them. If source files change after packing, a technical helper must repack before testing the new version. There is no need to rerun `pnpm check` just to follow this guide.

## 2. Open the app and finish setup

These steps do not start paid agent work.

1. Find the `Code Factory: http://127.0.0.1:...` line in the terminal. Copy the address into your browser's address bar and press Enter. Keep the terminal open.
   **Expected:** A page titled **Connect your first project** opens. If the page does not load, send the exact terminal output and the address you used.
2. In **Project name**, type `THI-19 Test`. Check that **Local project path** points to the disposable `project` folder, not the code-factory source folder.
   **Expected:** The name is accepted and the path is shown as read-only.
3. In **Coding agent**, select **Kiro** and press **Verify connection**.
   **Expected:** If Kiro is installed and signed in, it becomes connected. Its capabilities say Streaming **Available**, Guidance **Unsupported**, and Recovery **Unsupported**. If verification fails, copy the message and stop the agent tests; you can still report on the other screens.
4. In **Default model**, leave **Agent default** selected. Press **Finish setup**.
   **Expected:** The main factory opens. **Runs** is empty. Nothing should start running by itself.
5. Open **Settings** and check that the project name and Kiro default were saved. Return to **Runs**.
   **Expected:** The saved values remain visible. Detected agents should not be described as connected until they are verified.

If these five steps pass, continue below. If one fails, stop and use the report form in section 6. You do not need a screenshot for a pass.

## 3. Check the screens without running an agent

Do these before any paid agent run. Report any result that differs from **Expected**.

1. Open **Loops**. Press **Create empty loop**. Type a loop title, such as `THI-19 Small Test`.
   **Expected:** A draft editor opens. There is no agent work yet.
2. In the **Implementation** column, press **+ Add step**. Select the new step, enter a short instruction such as `Create proof.txt containing THI-19 test`, then press **Done**. Press **Save draft**, then **Publish v1**.
   **Expected:** The Loops library shows the published version. If publishing gives an error, copy its exact text and stop here.
3. On the published loop, press **Export JSON**. Then press **Import JSON** and paste the exported file's contents into the import box. Preview it before importing.
   **Expected:** The import shows a separate draft. The published version remains available.
4. If you want to test native configuration, open a loop draft and find **Native configuration translation**. Choose the offered Cursor format, choose Import or Export, then press **Preview** before **Apply**.
   **Expected:** The preview names the file it would use and explains any conflict or lost/unsupported fields. If it says there is a conflict, do not apply it. This feature does not connect Cursor for agent work.
5. Use only the keyboard for a short pass: press Tab to move between buttons; press Enter on a loop step to open its side panel; press Escape to close it. Open **New run** and press Escape to close it.
   **Expected:** You can see where keyboard focus is. The side panel and dialog close, and focus returns to the button or step you opened them from. Later, on a run graph, Enter should open a step inspector, left/right arrows should switch inspector tabs, and Escape should close it.
6. Make the browser window narrow, about phone width. Look at the Loops editor and the other screens you have visited. Turn on your operating system's **Reduce motion** setting and navigate again.
   **Expected:** Text and controls remain readable, nothing important is cut off, button transitions stop with Reduce motion, and statuses have words as well as colors.

## 4. Run one small task per agent

**This section can use agent quota.** Keep the task tiny and press **Execute run** only once per run. Use the one-step loop you published in section 3.

1. Open **Runs** and press **New run**. Choose the loop from section 3. Leave **Ticket number** empty. In the description, enter `Create proof.txt containing exactly THI-19 test`. Create the run.
   **Expected:** A new run opens in **Pending** state. No agent has started yet. Write down the run ID.
2. Press **Execute run** once. Wait for it to finish.
   **Expected:** The status goes from Pending to Running to Succeeded, with one attempt for the step. If it fails, do not press Retry yet; report the exact error.
3. Open the step in the run graph. Check **Activity**, **Files**, and **Details**.
   **Expected:** Activity shows the agent's progress. Files shows `proof.txt` and its read-only changes. Details shows the loop version and file/source identity. The original disposable project folder is not edited by the run.
4. Look at **Final evidence summary**.
   **Expected:** It says **Local validation: Incomplete** because this small loop has no check or review. **Accept evidence** is not available. This is expected, not a failure.
5. Write down the number of attempts shown. Refresh the browser page.
   **Expected:** The same finished run appears with the same attempt count. No new work starts.
6. To check service restart, go to the terminal running Code Factory and press Ctrl+C. Run `"$THI19_TEST/consumer/node_modules/.bin/code-factory" start --project "$THI19_TEST/project" --port 0` again. Open the **new URL** printed in the terminal. Return to the run.
   **Expected:** The finished run still has the same attempt count. No agent work starts. Verify the agent connection again in Settings if asked.

For a second-provider comparison, a technical tester should verify **Codex** in Settings, save it as the project default, then create a **new** run with the same published loop and exact description. The loop step must have no fixed provider binding. Check the new run's provider before pressing Execute. Compare status, attempt count, Activity, and `proof.txt` with the Kiro run. Codex supports guidance and recovery; Kiro reports those as unsupported. Cursor and Claude Code do not yet execute through this app. If this provider setup is unclear, stop and report it rather than spending quota on the wrong provider.

## 5. Advanced full-journey checks

**For a technical tester after sections 1–4 pass.** These checks use more agent calls. Keep the task small. If you cannot trigger a case safely, mark it **blocked** or **not observed**; do not spend quota repeating it.

1. **Configured ticket intake:** Set `CODE_FACTORY_LINEAR_API_KEY` in the service process environment using your own test token; never paste the token into a report. Restart the service, open **New run**, enter a test ticket ID and **Retrieve**. Check title/summary/attachments, create the run, and confirm the run snapshot keeps the retrieved ticket. Clear the ticket and confirm description-only intake still works. Without a token, record this path as blocked by tracker configuration.
2. **Parallel review:** In a new loop draft add one Implementation step, two Review agent steps, and one Validate check step. Connect the implementation to both reviews, make a parallel group of the reviews, then join both into validation with **all** mode. Keep reviewer instructions to a verdict on the small `proof.txt` change. Publish and run once. Check two separate review attempts inspect the same candidate and their receipts identify that candidate. A failed publish with a clear graph validation message is preferable to guessing connections.
3. **Guidance:** During a running Codex step, open that exact attempt's inspector and queue a short message. Look for queued → delivered or a truthful undelivered state tied to the same attempt. On Kiro the guidance control must remain disabled and say unsupported. If the Codex step ends before the message can be sent, record **not observed**, not a pass.
4. **Selected retry and freshness:** Use a disposable loop with a Validate check whose command is `test -f /absolute/path/to/your/disposable/retry-pass`. Choose a unique path outside the project and confirm the file is absent. The first check should fail without modifying the source candidate. A failed run should offer **Retry…** only on its latest failed attempt. Read the dialog's retained evidence and revalidation list. Create that marker file, then retry the selected check once; earlier attempts and logs should remain inspectable, with a new attempt ID. If an upstream implementation is rerun or its candidate changes, downstream check/review receipts must become stale; **Accept evidence** must not appear until fresh checks and reviews pass for the new candidate. Do not edit run history files to simulate freshness.
5. **Second round and abort:** Use a bounded repeat loop or the staged starter template only if quota permits; the staged template has six reviews and can be expensive. Observe one repair decision leading to round 2, then either a pass with fresh receipts or a terminal failure when the round limit is exhausted. Record which branch actually occurred. Do not claim both outcomes from a single run.
6. **Explicit acceptance:** On a genuinely succeeded run with current passing validation/review receipts, check **Local validation: Passed** and **Human acceptance: Pending**. Choose **Accept evidence** once. It should become accepted with a timestamp. A later candidate change should invalidate current acceptance while retaining the earlier acceptance receipt in history.

## 6. Report back

Send a short report even if you stop early. You do not need to understand the technical IDs; include any you can see. For a failure, copy the exact message and attach a screenshot if helpful. Never send tokens or passwords.

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
