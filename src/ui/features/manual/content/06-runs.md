# Runs

The **Runs** screen is where you start work and find it again. Its subtitle reads "Launch and review repeatable coding work." A run is one execution of one published loop version against one task in your project. Creating a run and executing it are two separate actions: **Start run** only records the run and prepares its Git branch, and nothing is sent to an agent until you open the run and press **Execute run**.

This chapter covers the list, the **Start a new run** dialog and the way a run freezes its inputs. The run's own page, with the graph, inspector and branch tools, is described in [Run detail](07-run-detail.md).

## The header

| Control               | What it does                                                                                         | What changes                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New run**           | Opens the **Start a new run** dialog. Shown only on the Runs screen and not in the demo factory.     | Nothing is saved until you press **Start run**.                                                                                                                  |
| **Open demo factory** | Switches to the demo factory, whose sample content is separate from your project and is never saved. | A banner reads "Demo factory · Sample content is separate from your project and is never saved." and **New run** disappears. Demo runs never enter your history. |

A short notice can appear under the header (for example when a command could not reach the runtime). It is informational and is replaced by the next one.

## What the screen shows

The Runs screen shows one of these states, in this order of priority.

| State                                 | What you see                                                                                                                                                                                                                          | What to do                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Loading                               | **Loading run history…**                                                                                                                                                                                                              | Wait.                                                                                                 |
| History could not load                | A card titled **Could not load run history** with the error and a **Retry** button.                                                                                                                                                   | Press **Retry**, or check that the local runtime is still running.                                    |
| A run is selected                     | The run detail page.                                                                                                                                                                                                                  | See [Run detail](07-run-detail.md).                                                                   |
| A run link cannot be loaded           | While connected, **Loading selected run…**. When the runtime cannot be reached, a card titled **Run unavailable** reading "The selected run could not be loaded from the local runtime." with **Reconnect** and **All runs** buttons. | **Reconnect** reloads the history. **All runs** returns to the list.                                  |
| Runs exist                            | The runs list below, with a line above it reading **Local runtime connected** or "Disconnected · saved history may be stale".                                                                                                         | Search, filter and open a run.                                                                        |
| Runtime unreachable and no runs known | A card titled **Runtime disconnected** reading "Run history is unavailable until the local runtime reconnects." with **Reconnect**.                                                                                                   | Press **Reconnect**.                                                                                  |
| Empty                                 | A dashed card titled **No runs yet**: "Create a loop for this project or start from an optional template. Demo runs never enter your history." with **Create loop** and **Use starter template** buttons.                             | Create or choose a loop (see [The Loops library](04-loops-library.md)), publish it, then start a run. |

A run is opened by clicking its row, and the address in the browser changes to `#runs/<run id>`. You can bookmark it or use the browser's Back button to return to the list. While the list is on screen it refreshes itself every 5 seconds.

## The runs list

The list is headed **Run history**. It has a search box, five status filters and one row per run, in the order the runtime returns them.

| Control                            | What it does                                                                                                                        | What changes                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Search runs, tickets, or tasks** | Narrows the rows to runs whose title, ticket number, task description, loop name or run ID contains the text. Case does not matter. | Rows are hidden, not deleted. Clear the box to see them again.                                             |
| **All**                            | Shows every run.                                                                                                                    | The default.                                                                                               |
| **Active**                         | Shows runs whose status is Pending or Running.                                                                                      | Other rows are hidden.                                                                                     |
| **Waiting**                        | Shows runs whose status is exactly Waiting.                                                                                         | Other rows are hidden. Runs waiting for input or paused are not in this filter; they appear under **All**. |
| **Failed**                         | Shows runs that are Failed, Rejected, Blocked, Unavailable or Canceled.                                                             | Other rows are hidden.                                                                                     |
| **Completed**                      | Shows runs that are Completed.                                                                                                      | Other rows are hidden.                                                                                     |
| A run row                          | Opens that run.                                                                                                                     | The page changes to the run detail.                                                                        |

When no run matches the search and the chosen filter, the list says "No runs match this search and status."

### Columns

On a wide window each row has five columns. On a narrow window the same facts are stacked inside each row.

| Column            | What it shows                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**          | The title in bold: the retrieved ticket's title if one was retrieved, otherwise the ticket number, otherwise the first 80 characters of the description. Under it, the ticket number (or "Description only") and the run ID. |
| **Loop**          | The loop name and its published version, for example "v2". This is the version frozen into the run.                                                                                                                          |
| **Status**        | The run's current status (see below).                                                                                                                                                                                        |
| **Started**       | The date the run was created, in your locale's date format.                                                                                                                                                                  |
| **Last activity** | A one-line preview of the newest event. For an agent message it is the last non-empty line of the text, shortened to about 120 characters. Otherwise it is the event's title. A run with no events reads "No activity yet".  |

### Status values

| Status                              | Meaning                                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pending**                         | The run exists and has its branch, but **Execute run** has not been pressed. No agent has run.                                                                              |
| **Running**                         | The run is executing steps.                                                                                                                                                 |
| **Waiting**                         | A status the run list can filter on. The runtime does not currently put a run into it on its own, so you will rarely see it.                                                |
| **Waiting-input**                   | A step's agent asked you a question and is waiting for your answer.                                                                                                         |
| **Paused**                          | A step's agent session is paused. Code Factory has no control that pauses a run.                                                                                            |
| **Completed**                       | Every step finished or was skipped by the loop's path.                                                                                                                      |
| **Failed**                          | A step failed, the setup command failed, or the last step could not finish. The workspace and evidence are kept.                                                            |
| **Canceled**                        | You canceled the run.                                                                                                                                                       |
| **Rejected**                        | A reviewer asked for changes and the loop had no repair round left, or the repeat limit was reached.                                                                        |
| **Blocked**                         | A reviewer reported that it could not finish its review and gave a blocked verdict.                                                                                         |
| **Unavailable**                     | Execution could not continue or could not be recovered after a restart. For example the run's recorded branch was missing, or an agent did not confirm that it had stopped. |
| **Issue tracker connection needed** | The run failed because the agent could not read the ticket through its issue tracker connection. This label replaces **Failed**.                                            |

## The Start a new run dialog

**New run** opens a dialog titled **Start a new run**. Its description says: "The task, published loop version, resolved agent binding and Git baseline are saved with the run." The cursor starts in **Ticket number**.

### Fields

| Control                                              | What it does                                                                                                                                                                                                                                                      | What changes                                                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project**                                          | Shows the project you launched Code Factory in, with the note "CLI selected workspace". It is not editable; the project is the folder you started the CLI from.                                                                                                   | Nothing.                                                                                                                                                                        |
| **Published loop**                                   | A drop-down listing every published loop as "Name · vVersion". The first one is selected until you pick another. Only published versions are offered, because only a published version is immutable.                                                              | Selects which loop version the run will freeze. If the list is empty the dialog shows "No published loop is available." and **Start run** stays disabled. Publish a loop first. |
| **Ticket number** (optional)                         | The ticket to work on, such as `PROJ-123`. Text is stored in capitals. The format is a short project key, a hyphen and a number that does not start with zero.                                                                                                    | Used for the run title, the default branch name and the task the agent receives. See the next section.                                                                          |
| **Retrieve**                                         | Looks the ticket up in the tracker you configured and shows it. Pressing Enter inside **Ticket number** does the same. The button is disabled when the box is empty, when no tracker is configured, or while a lookup is running (it then reads **Retrieving…**). | A green card shows "ID · title", the ticket summary and any attachment titles. Nothing is saved until you press **Start run**.                                                  |
| **Task description** (optional with a ticket number) | Free text describing the change, its constraints and the expected outcome, up to 20,000 characters.                                                                                                                                                               | It is saved in the run and is part of what every step receives. A ticket alone is enough; without a ticket this field is required.                                              |
| **Branch**                                           | The name of the Git branch the run will create. See "The run branch".                                                                                                                                                                                             | Leaving it empty uses the default. A rule violation shows a red message under the box.                                                                                          |
| **Cancel**                                           | Closes the dialog.                                                                                                                                                                                                                                                | Nothing is saved.                                                                                                                                                               |
| **Start run**                                        | Creates the run (it reads **Starting…** while it works).                                                                                                                                                                                                          | The dialog closes and the new run opens in its Pending state.                                                                                                                   |

Under the fields a summary line shows the chosen loop, for example "Implement → Review → Validate · Published v1 · 3 steps".

### Tickets and the tracker

What the dialog does with a ticket number depends on whether a tracker (an issue-tracker API key) is configured in Setup.

| Situation                | What you see                                                                                                                                                                                                         | What happens at **Start run**                                                                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A tracker is configured  | **Retrieve** is available. After a ticket is retrieved the card shows its details.                                                                                                                                   | **Start run** stays disabled until the ticket in the box has been retrieved. Editing the number clears the card and you must retrieve again. The retrieved title, summary and attachments are saved in the run.                                              |
| No tracker is configured | **Retrieve** is disabled and a note explains: "The selected agent will read this issue through its configured issue tracker MCP (for example Jira or Linear) when the run starts. Connect it in that AI tool first." | You can start without retrieving. Only the ticket number is saved, and the agent reads the issue through its own tracker connection when it runs. If it cannot, the run fails with **Issue tracker connection needed** (see [Run detail](07-run-detail.md)). |

Retrieval messages:

| Message                                                                       | Meaning                                                                                 |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Loading ticket…**                                                           | The lookup is in progress.                                                              |
| "Ticket not found. Check its number or clear it."                             | The tracker has no such ticket.                                                         |
| "Tracker authentication failed. Reconfigure the tracker or clear the ticket." | The tracker rejected the saved key.                                                     |
| "Ticket retrieval failed. Retry or clear the ticket."                         | Any other failure. Try again, or empty **Ticket number** to start from the description. |

### The run branch

Every run works on its own new branch in your project. **Start run** creates the branch at your current commit and switches your checkout to it. Each successful step that changes files is committed on that branch, using your own Git identity and hooks. Nothing is pushed.

The help text under **Branch** says: "Code Factory creates this new branch in your project and switches your checkout to it; each step is committed there. Commit or stash your own changes first. Empty uses code-factory/<run id>."

The branch name is what you typed. If you never touched the box, it follows the ticket number as you type it (in capitals). With no ticket and no name, the branch is `code-factory/` followed by the first eight characters of the run's ID.

A name is refused, with a message under the box, when it:

- is longer than 200 characters, or contains spaces or control characters;
- starts with a hyphen, contains `@{`, or is `HEAD`;
- is a protected name: `main`, `master`, `default`, `production`, `trunk` or `develop`, in any capitalisation;
- is rejected by Git as a branch name.

A name that already exists is never reused or overwritten. The dialog then shows the error and a button, for example **Use PROJ-123-2**, that fills in a free alternative.

### What blocks Start run

**Start run** is disabled while any of these is true, and the dialog says why where it can.

| Condition                                               | What you see                                                                                                                                                                                                                            | How to clear it                                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No published loop                                       | "No published loop is available."                                                                                                                                                                                                       | Publish a loop in the Loops screen.                                                                                                                       |
| No verified default agent                               | "Verify an authenticated default agent connection before starting."                                                                                                                                                                     | Verify the connection and pick a default agent in Settings.                                                                                               |
| A step's agent, model or effort is unavailable          | A red message under **Published loop**: "<provider> binding is unavailable until its connection is verified and authenticated.", "Model <id> is unavailable in the current catalog." or "Effort <level> is unavailable for this model." | Verify that agent in Settings, or change the step's binding in the loop. Every step is checked: its own binding, or the project default when it has none. |
| A ticket entered but not retrieved (tracker configured) | The button stays grey.                                                                                                                                                                                                                  | Press **Retrieve**, or clear **Ticket number**.                                                                                                           |
| A start is already in progress                          | The button reads **Starting…**.                                                                                                                                                                                                         | Wait.                                                                                                                                                     |

Pressing the button with neither a description nor a ticket shows "Enter a description or retrieve a ticket." An invalid branch name shows the rule that failed.

After you press **Start run** the runtime can still refuse. These errors appear in red in the dialog, and nothing is created.

| Error                                                                                                                                                    | Cause                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| "The project has uncommitted changes. Commit or stash them yourself, then start the run again; Code Factory never stashes, resets or cleans your files." | Your checkout has changes.                                  |
| "The project has no commits yet. Make a first commit, then start the run."                                                                               | The repository is empty.                                    |
| "A merge, rebase, cherry-pick, revert or bisect is in progress in the project. Finish or abort it first."                                                | Git is in the middle of another operation.                  |
| "Configure Git user.name and user.email for this repository. Code Factory never changes Git config."                                                     | Commits would have no author.                               |
| "Run … on branch … is still … in this project. Finish or cancel it before starting another run."                                                         | Only one run at a time may hold your checkout.              |
| "The selected project must be the root of a Git repository."                                                                                             | The CLI was started in a subfolder or a folder without Git. |
| "Verify and authenticate <provider> before starting."                                                                                                    | The agent's connection is no longer verified.               |

Double clicks and retries are safe. Each form state has its own request ID, so submitting the same form twice returns the same run rather than creating two. Changing any field creates a fresh request ID.

## Pending and executing runs

After a successful start the app opens the new run straight away. It is **Pending**, its branch exists, your checkout is on it, and no step has run. In the list a Pending run has no activity.

| Run state                                                  | What you can do                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pending**                                                | **Execute run** to start it, or **Cancel run** to discard it without running anything. A canceled pending run records "Canceled before execution."; your checkout stays on its branch until you switch back (see Run detail). |
| **Running**, **Waiting-input**, **Paused**                 | Watch, answer questions, give guidance, **Cancel run**. If the runtime was restarted and nothing is executing the run, a **Resume run** button appears instead of **Execute run**.                                            |
| **Failed**, **Blocked**                                    | **Retry** the failed or blocked step if it still has attempts left.                                                                                                                                                           |
| **Completed**, **Rejected**, **Canceled**, **Unavailable** | Inspect evidence, accept it, create a ticket branch or return to your previous branch.                                                                                                                                        |

Before the first step runs, Code Factory may ask two things. These questions are asked when you press **Execute run**, **Resume run** or a retry button, not at **Start run**.

| Dialog                                                                                                                                                                          | When it appears                                                                                                  | Choices                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trust this project?**                                                                                                                                                         | The project is not yet trusted. It lists the setup, check and custom-agent commands the project defines.         | **Trust project** saves the trust in your own Code Factory settings. **Cancel** stops the action.                                                                                |
| A tool permission question, such as **Allow Kiro to run shell commands?**, **Allow Codex to run commands outside its sandbox?** or **Allow Claude Code to run shell commands?** | A step is bound to a provider that needs a tool grant, and the project has none stored. Asked once per provider. | **Allow and run** saves the grant for the project. **Run without shell** or **Keep commands sandboxed** continues without it for this page session. **Cancel** stops the action. |

If a project setup command is configured, it runs once before the first step. If it fails, the run ends as Failed with a banner pointing to the setup command.

## The snapshot: what a run freezes

When you press **Start run**, Code Factory saves a snapshot inside the run. The run reads only from its snapshot, so later edits elsewhere cannot change it.

| Frozen in the snapshot | What it means                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The loop version       | The complete published loop: steps, instructions, dependencies, groups, joins, decisions and attempt limits. Publishing a newer version later does not affect the run, which keeps showing the version it started with. |
| The bindings           | For every step, the agent, model and effort it uses. A step with its own binding keeps it. A step without one receives the project's default agent at that moment, and keeps it.                                        |
| The task               | The description and, if you retrieved one, the ticket title, summary and attachments. Without a tracker, only the ticket number.                                                                                        |
| The Git baseline       | The commit the run started from, the run branch, and the branch you were on so the run can switch back.                                                                                                                 |
| The setup command      | The project's setup command as it was at the start.                                                                                                                                                                     |

Everything that happens afterward (attempts, events, receipts, file changes) is appended to the run and never rewritten.

### What changes with each input

| Input                                   | What it changes                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Published loop**                      | Which steps run, in what order, with which instructions, review rules, attempt limits and repair rounds.                                                           |
| Project default agent (set in Settings) | The agent, model and effort used by every step that has no binding of its own, captured at the start. Changing it later affects new runs only.                     |
| **Ticket number**                       | The run title and row label, the default branch name, the commit subjects (`<ticket>: <step name> (<step id>) attempt <n>`) and the ticket text the steps receive. |
| **Task description**                    | The text every step receives in addition to the ticket. It is also the run title when there is no ticket.                                                          |
| **Branch**                              | The name of the run branch. It also labels commits when there is no ticket and the name does not start with `code-factory/`.                                       |
| Retrieved ticket (tracker configured)   | A fixed copy of the ticket text. Edits in the tracker afterward are not reflected.                                                                                 |

If a connection is lost after the run was created, the snapshot is unchanged. Executing still needs the step's agent to be connected in the current session, and the run says so when it is not: "<provider> is not connected in this Code Factory session (verified connections last until the runtime restarts). Verify it in Settings, then retry this step."
