# Run detail

Clicking a run in the list opens its detail page. This is where you execute the run, watch it, answer its agents, retry a step, read the evidence, accept it and finally turn its branch into a ticket branch. The page is built from a header, optional banners, a graph of the run's steps, a row of icon buttons and a side panel called the inspector.

The page keeps itself current. While it is open the runtime pushes each new event as it happens, and the page also refreshes the run once a second as a fallback.

## The header

The header stays at the top while you scroll.

| Control             | What it does                                                                                                                                                               | What changes                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **← All runs**      | Returns to the runs list.                                                                                                                                                  | The address returns to `#runs`. The run keeps executing in the background. |
| Title               | The run's title: the ticket title, else the ticket number, else the start of the description.                                                                              | Nothing. Hovering shows the full text.                                     |
| Subtitle            | The ticket number (or "Description only"), the loop name and version, the implementation round and the run ID.                                                             | Nothing. The round starts at 1 and increases when a repair round begins.   |
| **Accept evidence** | Records that you accept the evidence. Shown only when local validation has passed and the evidence is not accepted yet. It reads **Recording acceptance…** while it works. | An acceptance receipt is appended to the run. See "Accepting evidence".    |

Under the title a status line shows:

| Item                                                                                                              | Meaning                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The run status                                                                                                    | One of **Pending**, **Running**, **Waiting-input**, **Paused**, **Completed**, **Failed**, **Canceled**, **Rejected**, **Blocked**, **Unavailable** or **Issue tracker connection needed**. See the status table in [Runs](06-runs.md). |
| "N active steps"                                                                                                  | How many steps are running right now.                                                                                                                                                                                                   |
| "N of M complete"                                                                                                 | How many steps have succeeded, out of all steps in the loop.                                                                                                                                                                            |
| "Local validation: **Passed** or **Incomplete** · Human acceptance: **pending**, **accepted** or **invalidated**" | The evidence state. See "Evidence summary".                                                                                                                                                                                             |
| The branch name                                                                                                   | The run branch, in a monospaced font. Shown when the run has one.                                                                                                                                                                       |
| The connection text                                                                                               | See the table below.                                                                                                                                                                                                                    |

### Connection text

| Text                                                  | Meaning                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| "Live event stream" (green)                           | The page is receiving events as they happen.                                                                          |
| "Runtime reachable · polling" (green)                 | The runtime answers, and the live stream has not been established yet.                                                |
| "Event stream reconnecting · runtime reachable" (red) | The live stream dropped; the page is still polling.                                                                   |
| "Disconnected · work state unknown" (red)             | The runtime cannot be reached. Execution may still be going on. Every command button is disabled until it reconnects. |

A bar under the graph repeats this: "Receiving run updates" or "Reconnecting to runtime…", with an **Inspect run evidence** button that opens the inspector on the whole run.

## Executing and controlling a run

The execution controls are small icon buttons floating at the top right of the graph. Each appears only when it applies, and all of them are disabled while the runtime is disconnected.

| Control                            | When it appears                                                                                                                     | What it does                                                                                                                                                                                         | What changes                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Execute run** (play icon)        | The run is **Pending**.                                                                                                             | Starts the run. First it may ask you to trust the project or grant a tool permission (see [Runs](06-runs.md)). While the request is in flight the button is busy and its tooltip reads "Executing…". | The run becomes **Running**. The project's setup command, if any, runs once; then the first ready steps start.                               |
| **Resume run** (play icon)         | The run is **Running**, **Waiting-input** or **Paused**, but the runtime says nothing is executing it, for example after a restart. | Takes up the run again. Nothing resumes on its own after a restart.                                                                                                                                  | Interrupted attempts are recovered when the agent supports it, otherwise the step is marked interrupted and the run becomes **Unavailable**. |
| **Retry <step name>** (retry icon) | The run is stopped on a step that can be retried.                                                                                   | Starts a new attempt of that step at once, without a confirmation dialog.                                                                                                                            | See "Retrying a step".                                                                                                                       |
| **Cancel run** (red stop icon)     | The run is **Pending**, **Running**, **Waiting-input** or **Paused**, or a command is in progress.                                  | Cancels without asking for confirmation.                                                                                                                                                             | See "Cancelling".                                                                                                                            |

There is no pause button. A **Paused** status can only be reported by an agent session.

### Cancelling

- If the run is executing, the running agents and checks are asked to stop. The run ends as **Canceled**. A step that was in progress is left waiting, and its attempt is recorded as canceled. If the agent does not confirm that it stopped, the run ends as **Unavailable** and the step records why.
- If the run is **Pending**, or **Running** between steps with nothing active, it is marked **Canceled** directly, with the event "Run canceled" ("Canceled before execution." or "Canceled while not executing.").

A canceled run keeps its branch, its commits and all of its evidence. Cancelling is also how you give up on a run that holds your checkout: only one run at a time may work in your project, and a run that has finished (any terminal status) lets you start another.

### Retrying a step

A step can be retried when one of these is true and no other step is active:

- the run is **Failed** and the step is **failed**; or
- the run is **Blocked** and the step is a reviewer that holds a blocked verdict.

Each step has an attempt limit per implementation round, set in the loop's policy (by default 3). When it is reached, nothing offers a retry, and the banners say so. A new implementation round, started by a repeat group's repair path, restores the budget.

A retry creates the next attempt of the same step, in the same branch and workspace. Edits already made stay, and all earlier attempts, logs, files and artifacts stay inspectable. The step and every step that depends on it are reset to **pending**, and results from completed dependents are marked "superseded · needs revalidation". Independent steps that already completed remain complete. The retry is recorded with the events "selected-step-retry" and "retry-invalidated". Retrying the same attempt twice does nothing the second time.

The retry control appears in four places. All of them start the same operation.

| Where                                                 | Control               | Confirmation                             |
| ----------------------------------------------------- | --------------------- | ---------------------------------------- |
| The floating controls                                 | **Retry <step name>** | None.                                    |
| A small round button pinned to the failed step's node | The same label        | None.                                    |
| The stop banner                                       | **Retry <step name>** | None.                                    |
| The inspector header                                  | **Retry…**            | Opens the **Retry <step name>?** dialog. |

The **Retry <step name>?** dialog is headed "New step attempt". It says it will "Create Attempt N for <step> (<id>) in this run only", and that the attempt limit is separate from the loop's total implementation rounds. Three notes follow.

| Note                             | What it says                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Retained edits**               | Existing workspace changes remain available to this attempt.                                                                               |
| **Retained evidence**            | Earlier attempts, logs, files, and artifacts remain inspectable.                                                                           |
| **Results needing revalidation** | Lists completed downstream steps that will be reset, or "No completed downstream results." Independent completed siblings remain complete. |

Its buttons are **Cancel** and **Start Attempt N**.

The **Retry…** button in the inspector is disabled, with a tooltip, when the retry is not available now.

| Tooltip                                              | Reason                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| "Reconnect the runtime first."                       | The page cannot reach the runtime.                             |
| "Work is already active."                            | A command is in progress.                                      |
| "Only failed or blocked review work can be retried." | The step or run is not in a retryable state.                   |
| "Select the latest attempt to retry."                | An older attempt is selected in the inspector.                 |
| "Verify this step's connection before retrying."     | The step's agent is not authenticated. Check steps are exempt. |
| "Attempt limit reached for this step."               | No attempts left in this round.                                |

If the step's agent is not connected in the current session, the retry is refused with "<provider> is not connected in this Code Factory session (verified connections last until the runtime restarts). Verify it in Settings, then retry this step."

## Banners above the graph

At most one of the first two banners is shown at a time.

### Stop banner

When a run ends as **Blocked**, **Failed** or **Canceled**, a banner names what stopped it. Its text is the step's own summary, shortened to three lines.

| Heading                             | Cause                                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "<step> blocked the run"            | A reviewer reported a blocked verdict. The summary is the reviewer's findings.                                                                                                |
| "<step> failed"                     | A step's latest attempt failed. The summary is the newest of the step's completion text or Code Factory's own reason (see "Event names").                                     |
| "The setup command stopped the run" | The project setup command failed, timed out or was canceled. The banner adds "Fix the setup command in Setup, then start a new run." No step can be retried; start a new run. |
| "The run was canceled"              | You canceled the run and no step had failed.                                                                                                                                  |

| Control               | What it does                                                                                                                           | What changes           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Retry <step name>** | Starts a new attempt of the named step. Shown only when a retry is allowed. Disabled while disconnected or while a command is running. | See "Retrying a step". |
| **Inspect step**      | Opens the inspector on that step's latest attempt.                                                                                     | Nothing is changed.    |

### Issue tracker banner

If the run failed because the agent answered that it could not read the ticket, the banner is titled **Connect your issue tracker to continue** and replaces the stop banner. It explains that you need to connect the tracker's connection (for example Jira or Linear) in your AI tool's settings, then retry. If the step has no attempts left, it adds "This step has reached its retry limit. Start a new run after connecting your issue tracker."

| Control                    | What it does                               | What changes                       |
| -------------------------- | ------------------------------------------ | ---------------------------------- |
| **Retry after connecting** | Retries the step whose lookup failed.      | A new attempt of that step starts. |
| **Inspect attempt**        | Opens the inspector on the failed attempt. | Nothing is changed.                |

### Agent input request

When an agent in a step asks you a question and waits for the answer, the run becomes **Waiting-input** and a yellow panel titled **Agent waiting for input** appears. It reads "The active turn is waiting for your answers." and warns that the request has no verified timeout. Cancel the run if you do not want to answer. A canceled or restarted attempt needs a new request.

For each question the panel shows its header, the question text and its suggested options with descriptions, followed by a text box. Every box must be filled.

| Control                       | What it does                                                                                                                                                         | What changes                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Answer box (one per question) | Takes your answer as text, even when options are suggested.                                                                                                          | Nothing until you send.                                                                            |
| **Send answers**              | Sends all answers to the agent (it reads **Sending…**). Disabled while a box is empty, when the runtime is disconnected, or when the agent does not support replies. | The attempt returns to running, and the run to **Running**. The answers are saved in the evidence. |

If the agent cannot take replies the panel says "Native input replies are unavailable for this connection." If delivery cannot be confirmed, the panel is replaced by **Reply delivery is unconfirmed**. It explains that your answer was recorded but not confirmed, and tells you to cancel the run and retry the step to receive a new request.

## The execution graph

The section titled **Execution** says "Observed graph · node positions do not change execution order." It draws the loop frozen in the run, with arrows for dependencies. Steps are arranged left to right by how many dependencies precede them. A dashed frame around steps is a group, labeled with its name and kind: **parallel** (members run side by side) or **repeat** (the body can run again for a repair round).

| Control              | What it does                                                                                                                                      | What changes                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Zoom out** (−)     | Reduces the zoom by 10 points, down to 25%.                                                                                                       | The graph is scaled; **Fit view** stops being pressed. |
| **Zoom in** (+)      | Raises the zoom by 10 points, up to 150%.                                                                                                         | The same.                                              |
| The percentage       | Shows the current zoom.                                                                                                                           | Nothing.                                               |
| **Fit view**         | Returns to following the width of the canvas, so the whole graph shows without scrolling (never larger than 100%). Shown as pressed while active. | The zoom is recomputed whenever the window resizes.    |
| A step node          | Selects the step and opens the inspector on its latest attempt.                                                                                   | The node gets a ring while selected.                   |
| Arrow keys on a node | Right or Down moves to the next step in the loop's order, Left or Up to the previous one; Enter opens the focused step.                           | Selection and focus move.                              |

### A node

Each node shows, from the top:

- a status badge and, at the right, the time the step has spent running, such as `42s`, `3m 12s` or `1h 04m`, summed across its attempts and counting up while an attempt runs. Nothing is shown when the time is unknown, for example while an attempt is waiting for input or paused;
- the step's name;
- its role and its number of attempts, such as "Implementer · 2 attempts";
- for agent steps, three lines: **Agent:** the provider, **Model:** the model's display name ("Agent default" when none was chosen) and **Effort:** the level (Default, or the name of the level with a capital).

The **Effort** line ends with a meter of small bars, one per effort level the agent offers, with as many filled as the chosen level's position. All bars empty means the agent default. No meter is drawn when the agent does not list levels, or when the saved level is no longer offered. Hovering the three lines shows "Inherited from the project default" when the step has no binding of its own. With no binding anywhere, each line says "Not configured". Check steps run a shell command, not an agent, so they have no Agent, Model or Effort lines.

These values come from the run's frozen bindings, so they show what actually ran even if you later change the project default.

### Step statuses

| Badge             | Meaning                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **pending**       | Waiting for its dependencies.                                                                                              |
| **running**       | An attempt is in progress.                                                                                                 |
| **waiting-input** | The attempt is waiting for your answer.                                                                                    |
| **paused**        | The attempt's session is paused.                                                                                           |
| **succeeded**     | The latest attempt succeeded. A reviewer's blocked verdict is also stored as succeeded; see the run status.                |
| **failed**        | The latest attempt failed.                                                                                                 |
| **waiting**       | An attempt was canceled or could not be confirmed, so the step has no live attempt.                                        |
| **skipped**       | The loop's decisions chose another path, so this step is not required.                                                     |
| **Not reached**   | A step that was still pending when the run stopped as Blocked, Failed, Canceled or Rejected. This is only a display label. |

Attempts carry their own statuses: running, waiting-input, paused, succeeded, failed, canceled and **interrupted** (the process was gone when the runtime restarted).

## The icon row

Next to the execution controls is a small row of buttons. Each opens a dialog; only one dialog is open at a time.

| Control                    | What it does                                                                                                                                                                                                                                                                              | What changes                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Description**            | Opens a dialog titled **Description** with the ticket number and title (or "Description-only run") and the retrieved ticket text and your description, rendered as formatted text. When no tracker was available, it says the ticket is read by the agent through its tracker connection. | Nothing.                              |
| **Run branch**             | Opens the branch dialog. Shown only when the run has a workspace. See "The run branch dialog".                                                                                                                                                                                            | Nothing until you use a button in it. |
| **Final evidence summary** | Opens the evidence dialog. A small amber dot means evidence is ready to accept. A green dot means it is accepted.                                                                                                                                                                         | Nothing until you use a button in it. |

## The inspector

Clicking a node, **Inspect step**, **Inspect attempt** or **Inspect run evidence** opens the inspector, a panel fixed to the left side of the window. It starts at 520 pixels wide.

| Control              | What it does                                                                                             | What changes                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Scope label          | Reads "Run scope", or "Step · <id> · Attempt N" or "All attempts".                                       | Nothing.                                                                                          |
| **Close**            | Closes the inspector. The Escape key does too, except while the retry dialog is open.                    | The panel disappears and focus returns to where you were.                                         |
| **Run scope**        | Switches from a step to the whole run: all steps, all evidence.                                          | Every tab now shows the run's data.                                                               |
| **Selected attempt** | A drop-down of **All attempts** and each "Attempt N · status". Shown for a step.                         | Every tab is limited to that attempt.                                                             |
| **Retry…**           | Opens the retry dialog for the step.                                                                     | See "Retrying a step".                                                                            |
| **Resize inspector** | A thin slider on the panel's right edge. Drag it, or press Left and Right (24 pixels each).              | Width changes between 360 pixels and three quarters of the window.                                |
| Tabs                 | **Activity**, **Files (n)**, **Artifacts (n)** and **Details**. Left and Right arrows move between tabs. | Switches what the panel shows. The counts show the number of file and artifact receipts in scope. |

If the step or attempt you selected disappears from the run, the inspector falls back to the nearest valid scope.

### Activity

The list of events, in order, for the chosen scope.

| Control                                                  | What it does                                                                          | What changes                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Search activity**                                      | Keeps events whose title or detail contains the text.                                 | Other events are hidden.                                           |
| **All**, **Messages**, **Tools**, **Checks**, **Errors** | Filters by event type. **Messages** includes messages, lifecycle events and guidance. | The list is filtered.                                              |
| **Follow live**                                          | While checked, the list scrolls to the newest event as it arrives.                    | Unchecked, a button reads "N new events · Jump to latest" instead. |
| N new events · Jump to latest                            | Scrolls to the bottom.                                                                | The counter clears.                                                |

"Runtime reachable" or "Disconnected · execution state unknown" is shown under the controls. An empty list reads "No matching activity. A quiet stream does not mean the step failed." Consecutive pieces of one agent message are joined into a single entry. A question to you or a guidance message starts a new entry. Agent messages and completion summaries are shown as formatted text; tool and check output is shown exactly as written. Each entry has a type badge, a timestamp, and a title when it says more than the type.

The **Step guidance** form sits under the list while this tab is open.

| Control                          | What it does                                                                                                                                                                                     | What changes                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Message for selected attempt** | A text box of up to 10,000 characters. It is disabled unless one attempt is selected. A draft is kept for each attempt.                                                                          | Nothing until you queue it.                                                                          |
| **Queue guidance**               | Sends the message to the selected attempt. Enabled only when the runtime is connected, the step's agent is verified, the agent supports steering, the box has text, and the attempt is selected. | An entry appears under **Guidance history**. Delivery never interrupts or restarts the agent's work. |

A line above the form tells you why the button is off: "Select one step attempt to address guidance.", "A verified agent connection is required. Draft preserved.", "Steering is <state> for this connection. Draft preserved." or "Runtime disconnected. Draft preserved until it reconnects.". When the run is not running, it says that guidance for a finished attempt is recorded as undelivered.

Guidance history shows each message with its latest state:

| State            | Meaning                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Queued**       | Saved and waiting to be sent.                                                                                     |
| **Delivered**    | Handed to the agent.                                                                                              |
| **Acknowledged** | The agent's next reply mentioned it.                                                                              |
| **Rejected**     | Not delivered. A reason is shown, such as the attempt having already ended, or the agent not supporting steering. |

A message still queued when its attempt ends is marked rejected.

### Files

The files changed by the run, compared with the commit it started from. A note at the top names that baseline commit. Files changed before the run are listed in a separate section.

| Control           | What it does                                                                                                                                    | What changes                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Search paths**  | Keeps files whose path contains the text.                                                                                                       | The list is filtered.                                |
| **Change type**   | **All changes**, added, modified, deleted or renamed.                                                                                           | The list is filtered.                                |
| A file row        | Shows its path, change type and the step and attempt that produced it with freshness. "Attribution uncertain" means no matching receipt exists. | Selects the file and loads its diff below.           |
| **Download diff** | Saves the selected file's diff as `<name>.diff`.                                                                                                | A file is downloaded. Disabled until the diff loads. |

With a step or attempt scope, only that step's files are listed. In **Run scope**, a section **Pre-existing changes (n)** lists changes captured before the task; they are excluded from task diffs. Empty states read "No task changes are available for this scope. Select run scope to inspect unattributed changes." and "No paths match these filters."

### Artifacts

Artifacts are files an agent declared as evidence. The tab lists them with media type, step, attempt and freshness. An empty tab reads "No declared evidence artifacts for this scope. Changed source files are listed under Files."

Selecting an artifact shows its details (when produced, run, step and attempt, source, baseline and candidate, input receipts and freshness) and a preview. Images, JSON, Markdown and plain text are previewed; any other type says "Preview unavailable for this file type. Download the artifact to inspect it." The **Download** button saves the original file.

### Details

For a step: its instructions, role, kind, the agent, model and effort, the selected attempt and its status, the step status, its dependencies, expected outputs, candidate and input hash. For the run or a step it also shows the loop name and version, baseline commit, source commit, workspace, task source, when the baseline was captured and the implementation round. An **Evidence provenance** list names each check, review or acceptance receipt in scope, its source and whether it is current, "superseded · needs revalidation" or "invalidated · current validation inputs changed".

## Evidence summary

Code Factory keeps the evidence as an append-only record. It judges the run in two steps.

1. **Local validation** is **Passed** only when the run is **Completed**, and every check step and every reviewer in the path has a current receipt for its latest attempt that passed against the same code, and the loop contains at least one check or review. Otherwise it is **Incomplete** and the gaps are listed.
2. **Human acceptance** is **pending** until you accept, **accepted** after you do, and **invalidated** if the code or the validation inputs change after an acceptance.

The **Final evidence summary** dialog shows:

| Part                       | What it shows                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| **Changed files** (button) | The number of changed files. Opens the inspector's Files tab.                                |
| **Artifacts** (button)     | The number of artifacts. Opens the Artifacts tab.                                            |
| **Requirements met**       | How many check and review steps are satisfied.                                               |
| **Loop progress**          | Steps succeeded out of the total, such as "5/8".                                             |
| Accepted time              | "Accepted <time>" when accepted.                                                             |
| **Requirements**           | Each check and review step: **Met**, **Not required** (skipped) or the reason it is not met. |
| **Validation gaps**        | Reasons local validation is incomplete, or "None".                                           |
| **Review findings**        | Each reviewer's verdict (pass, changes-requested or blocked) and findings.                   |

If an earlier acceptance is no longer valid the dialog says so: "Earlier acceptance remains in the evidence history. Current inputs require fresh validation and acceptance."

### Accepting evidence

**Accept evidence** is offered in the header and in the evidence dialog when validation has passed. Pressing it records your approval of the current code. The acceptance is tied to the exact validation receipts and the current file contents; if either changes later, the status becomes **invalidated** and you must accept again. If the code cannot be read it fails with "Current source candidate is unavailable." Acceptance changes no file. Its only effect is that **Create ticket branch** becomes available.

## Check steps, reviews and failures

A check step runs a shell command from the loop, in your project folder, and records pass or fail with its output. The starter loops use checks for changed-files lint, type-check and coverage, and a diff check. Their gate script lives under `.code-factory/` and is never committed.

A reviewer is an agent that may only read. In your project, reviewers and checks must leave your files unchanged. If one changes any file, its result is replaced by a failure with the message that begins "Reviewer changed project files, so its result does not describe the committed candidate" (or "Check changed project files…"), listing the paths. Nothing is reverted. You must review or discard those changes yourself before executing again, because Code Factory refuses to continue with leftover changes ("A reviewer or check changed project files earlier in this run…").

Other ways a step fails:

| Cause                                                            | What you see                                                                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The agent said it succeeded but Code Factory rejected the result | A "result-rejected" event with the reason: an undeclared decision outcome, an undeclared or missing review verdict, or a review that asked for changes without findings. |
| The agent reported it could not read the ticket                  | The **Connect your issue tracker to continue** banner.                                                                                                                   |
| The agent's connection is missing in this session                | An "agent-not-connected" event, and a retryable failed step.                                                                                                             |
| A Git hook or Git rejected the step's changes                    | A "commit-failed" event and the failed step.                                                                                                                             |
| Your checkout moved off the run branch                           | A "checkout-moved" event: "The project is on branch X, not on run branch Y. Switch back with `git switch Y` to continue this run."                                       |
| The process ended unexpectedly                                   | The step is marked interrupted, the run becomes **Unavailable**, and an "execution-interrupted" or "recovery-unavailable" event gives the reason.                        |

When a reviewer asks for changes and the loop has a repair path, the repeat group starts a new implementation round and reopens its body. When no round is left, the run ends as **Rejected**. A blocked verdict ends as **Blocked**.

## The run branch dialog

The **Run branch** button opens this dialog. In every new run the run works in your project folder itself, on the branch created at **Start run**.

| Part                                  | What it shows                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Checkout line                         | "Your project checkout is on this branch (it was on <previous>)." or "Your project checkout is now on <branch>; this run's commits stay on <run branch>."                                  |
| Warning                               | "Branch <name> no longer exists." in amber when the branch was deleted.                                                                                                                    |
| **Branch** with **Copy branch**       | The branch name. The button copies it and reads **Copied**.                                                                                                                                |
| **Project** with **Copy path**        | The project folder.                                                                                                                                                                        |
| **Editor** with **Copy open command** | A drop-down of **VS Code**, **Kiro** and **Cursor**, remembered in your browser. The button copies a command such as `code -n '<path>'`, which is also shown. Nothing is launched for you. |
| **Commits (n)**                       | An expandable list of the commits on the run branch since the starting commit (up to 100), each with its short hash and subject. Empty: "No commits on the run branch yet."                |

### Commits

Each successful step that changed files gets one commit on the run branch, made with your Git identity and your hooks. The subject is `<ticket or code-factory>: <step name> (<step id>) attempt <n>`, and the body records the run, step, attempt and round. A step that changed nothing makes no commit. The event "commit-created" records each one. Reviewer and check steps never commit.

### Create ticket branch

| Control                  | What it does                                                                                  | What changes                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create ticket branch** | Opens the **Create ticket branch** dialog.                                                    | Nothing until you confirm.                                                                                                                                              |
| Branch name              | The new branch's name. It is filled with the ticket number; empty for a description-only run. | Typed text.                                                                                                                                                             |
| **Create branch**        | Creates the branch (**Creating…** while working).                                             | A local branch points at the tip of the run branch, with the same commits. Nothing is pushed, your checkout does not move, and an existing branch is never overwritten. |
| **Cancel**               | Closes the dialog.                                                                            | Nothing.                                                                                                                                                                |

The dialog says "Creates a local branch at the tip of <run branch> with the same commits. Nothing is pushed, and an existing branch is never overwritten." Branch names follow the same rules as in [Runs](06-runs.md), except that names beginning `code-factory/` are reserved for run branches. If the name exists, the error offers **Use <suggested name>**.

The button is disabled, with the reason beneath it, while any of these is true. They are checked in this order.

| Reason shown                                                                                                          | Meaning                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "This run already created branch <name>."                                                                             | A ticket branch exists. The panel then reads "Ticket branch <name> at <short commit>".                                                              |
| "This run already works on branch <name>."                                                                            | The run branch is already named after the ticket. The panel reads "The run branch already carries the ticket name, so there is nothing to promote." |
| "The project is on <branch>, not on run branch <run branch>. Switch back with `git switch …` to continue this run."   | Your checkout is elsewhere.                                                                                                                         |
| "This run's worktree was removed; branch <name> is kept." or "…worktree is missing at <path>; branch <name> is kept." | Only for older runs that used a worktree.                                                                                                           |
| "Accept the evidence before creating a ticket branch."                                                                | The evidence is not accepted.                                                                                                                       |
| "The run's files have uncommitted changes, so the branch would not match the accepted candidate."                     | The project has changes that are not on the branch.                                                                                                 |

It is also disabled while the runtime is disconnected or a command is running. If the branch moved while Code Factory was creating the ticket branch, the dialog reports a warning in amber, and the new branch points at the accepted commit. The events "ticket-branch-requested", "ticket-branch-created" and "ticket-branch-failed" record the attempt.

### Back to the previous branch

**Back to <previous branch>** (it reads **Switching…** while working) switches your project back to the branch it was on before the run started. It uses a plain `git switch`, never forced. It is disabled, with the reason beneath it, while the run has not finished ("Finish or cancel the run before switching back to …"), when your checkout is no longer on the run branch, when you have uncommitted changes ("The project has uncommitted changes. Commit or discard them before switching branches; Code Factory never stashes or resets your files."), or when the previous branch was deleted. The run branch and its commits remain after you switch. The event "checkout-returned" records it.

### Removing a run branch or worktree

Code Factory never deletes a run branch, and never deletes a ticket branch. To remove one you use Git yourself.

Runs created by older versions of Code Factory worked in a separate worktree. For those runs the dialog shows **Remove worktree…** instead of the way back. Its dialog, **Remove the worktree?**, says the run branch and any ticket branch are kept and that uncommitted changes block removal. Its buttons are **Cancel** and **Remove worktree** (**Removing…**). It is disabled while the run is active, and shows "The worktree has uncommitted changes. Commit or discard them in the worktree first." when blocked. Removal records "worktree-removed", and the panel then reads "Worktree removed · branch kept". Such runs also show a note when no setup command is configured, because dependencies may be missing in the worktree.

## Event names

Every entry in **Activity** has a type: **lifecycle**, **message**, **tool**, **check**, **error** or **guidance**. These are the titles you will see, grouped by where they come from.

| Title                                                                | Type      | Meaning                                                                                                                  |
| -------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| started, completed                                                   | lifecycle | The agent started a step, and its final report. The report text is shown as the detail.                                  |
| (message text)                                                       | message   | Streamed agent text.                                                                                                     |
| (tool name)                                                          | tool      | A tool call the agent made.                                                                                              |
| (check name)                                                         | check     | A check the agent reported.                                                                                              |
| (error text)                                                         | error     | An error reported by the agent.                                                                                          |
| Tool permission                                                      | lifecycle | What shell or tool access the step got, for example that a reviewer is read-only.                                        |
| Setup started, Setup output, Setup completed                         | check     | The project's setup command, once before the first attempt. Completed carries the exit code, or "Timed out after 900 s". |
| Check started, Check output, Check completed                         | check     | A check step's command, its output and its result.                                                                       |
| commit-created                                                       | lifecycle | The step's commit, with its short hash and subject.                                                                      |
| commit-failed                                                        | check     | Git or a hook refused the commit.                                                                                        |
| read-only-violation                                                  | check     | A reviewer or check changed files.                                                                                       |
| checkout-moved                                                       | check     | Your checkout left the run branch.                                                                                       |
| agent-not-connected                                                  | check     | The step's agent is not connected in this session.                                                                       |
| result-rejected                                                      | check     | Code Factory rejected an agent's reported success.                                                                       |
| selected-step-retry                                                  | lifecycle | A retry was started.                                                                                                     |
| retry-invalidated                                                    | lifecycle | A completed dependent step needs revalidation after a retry.                                                             |
| execution-interrupted, recovery-unavailable                          | lifecycle | A step was interrupted or could not be recovered. The run becomes **Unavailable**.                                       |
| worktree-missing                                                     | lifecycle | The run's recorded workspace is gone.                                                                                    |
| Run canceled                                                         | lifecycle | The run was canceled while idle.                                                                                         |
| ticket-branch-requested, ticket-branch-created, ticket-branch-failed | lifecycle | The ticket branch lifecycle.                                                                                             |
| checkout-returned                                                    | lifecycle | You switched back to the previous branch.                                                                                |
| worktree-removed                                                     | lifecycle | An older run's worktree was removed.                                                                                     |
| (guidance message)                                                   | guidance  | Your message to a running step.                                                                                          |

Events are numbered without gaps in the order they happened, and are never edited or removed.
