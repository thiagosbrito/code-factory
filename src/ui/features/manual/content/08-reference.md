# Reference and troubleshooting

Look-up material: how agents, models and effort behave for each provider, how the keyboard and screen readers are supported, what Code Factory writes to disk, which environment variables and command-line flags exist, and what to do when something goes wrong.

## Agents, models and effort

An agent has three separate facts, and Code Factory keeps them apart:

1. **Installed.** An executable was found on your PATH. Finding it proves nothing else. The setup form calls this **Executable detected** (or **Not detected**).
2. **Verified.** You (or the automatic connect) launched it and it identified itself and answered its handshake: **Identity verified**.
3. **Authenticated and connected.** It is signed in with its own login: **Connected**. Only then does Code Factory list models.

**Recheck agents** repeats step 1 without launching anything. **Verify connection** does steps 2 and 3 and launches the executable.

### What each provider offers

| Provider        | Executable looked for     | How it is verified                                                                                                        | Models                                                                                                                                                                                       | Effort levels                                                                       | Custom model id                                       |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Codex**       | `codex`                   | Runs the Codex app-server and reads the account. Reports the login type (ChatGPT, API key or Bedrock) without storing it. | Read from Codex's own catalog; hidden models are skipped.                                                                                                                                    | The levels Codex lists for each model.                                              | No. Only listed models.                               |
| **Kiro**        | `kiro-cli`                | `kiro-cli whoami --format json`, then `kiro-cli chat --list-models --format json`.                                        | Read from Kiro's catalog.                                                                                                                                                                    | None. The **Effort** slider does not appear.                                        | No. Only listed models.                               |
| **Claude Code** | `claude`                  | `claude auth status --json`; sign-in is checked, then the CLI is asked which models your login can use.                   | Asked from the CLI. If it cannot answer, the aliases **Fable (latest)**, **Opus (latest)**, **Sonnet (latest)** and **Haiku (latest)** (ids `fable`, `opus`, `sonnet`, `haiku`) are offered. | `low`, `medium`, `high`, `xhigh`, `max`, or the levels the CLI lists for the model. | Yes: **Custom model…** accepts any model id or alias. |
| **Custom**      | An absolute path you type | Launches that file and requires it to identify as Codex CLI and complete the Codex app-server handshake.                  | As Codex.                                                                                                                                                                                    | As Codex.                                                                           | No.                                                   |
| **Cursor**      | `cursor-agent` or `agent` | Detected only. It cannot be connected yet.                                                                                | None.                                                                                                                                                                                        | None.                                                                               | No.                                                   |

Every agent also has **Agent default** as a model. It leaves the choice to the agent itself, and "no effort" is the slider's first stop.

Each agent runs a step as follows. Kiro uses its v2 stream; Claude Code runs one `claude -p` stream-json invocation per step; Codex runs a turn through its app-server. Guidance and recovery are not available for Kiro or Claude Code; the **Guidance** and **Recovery** tiles in setup show **Unsupported** for them. For Codex they show what the connected version reports, which may be **Unknown for this connection**.

### Where choices are validated

A model or effort is checked more than once, so a stale choice is stopped before work starts.

| Where                 | When                                                                      | What is checked                                                                                                                            | Message if it fails                                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup form            | While you edit, and on **Save project** (only if you changed the default) | The agent is connected and signed in; the model is in its catalog (or the agent accepts custom ids); the effort is offered for that model. | "`<provider>` binding is unavailable until its connection is verified and authenticated.", "Model `<model>` is unavailable in the current catalog.", "Effort `<effort>` is unavailable for this model."                                                                     |
| Project setup request | When the save reaches the runtime                                         | Same checks against the live connection.                                                                                                   | "Verify and authenticate the selected agent before saving its default.", "Selected model is unavailable in the current agent catalog.", "Selected effort is unavailable for this model.", and for Custom: "Verify the current custom executable before saving its default." |
| Publishing a loop     | When you publish                                                          | Each step has a project default or its own binding, a verified signed-in agent, and an available model and effort.                         | "`<step>` needs a project default or step binding.", "`<step>` needs a verified, authenticated agent.", "`<step>` selects an unavailable model." (or effort).                                                                                                               |
| Creating a run        | When you start a run                                                      | Setup exists, a published loop is selected, a default is set, and the agent, model and effort are available.                               | "Configure the project before starting a run.", "Select a saved published loop.", "Select and verify a default agent connection.", "Verify and authenticate `<provider>` before starting.", "Model `<model>` is unavailable.", "Effort `<effort>` is unavailable."          |
| Step start            | When a step is about to run                                               | The agent is connected in this session.                                                                                                    | "`<provider>` is not connected in this Code Factory session (verified connections last until the runtime restarts). Verify it in Settings, then retry this step."                                                                                                           |
| Kiro adapter          | At execution                                                              | Kiro does not advertise effort levels.                                                                                                     | "Kiro does not advertise supported effort choices in its model catalog"                                                                                                                                                                                                     |

A model appearing in a list does not mean your account may use it. The model field says so: "Models come from this connection's catalog; listing does not guarantee entitlement."

Bindings are resolved once into each run's snapshot. Changing the project default later never changes a run that already exists.

### Connections and restarts

A verified connection lasts for the Code Factory session. For each project, Code Factory remembers which agents you connected (just the provider names and a custom executable path, never credentials) and connects them again at the next start. Restarted connections finish in the background, and a slow one is skipped after about twenty seconds so the screen still loads.

## Keyboard and accessibility

Everything below was checked in the interface code. Code Factory also uses standard controls (buttons, links, native drop-downs, a native range slider), so Tab, Shift+Tab, Enter and Space behave as in any web page.

### Across the app

| Where                                                        | Keys and behaviour                                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changing screen                                              | Focus moves to the page title (**Runs**, **Loops** or **Settings**) so a screen reader announces the new screen.                                                                                                                 |
| Sidebar                                                      | Navigation is a landmark named **Factory**; the active screen is marked as the current page. The run count is read as part of **Runs**. The collapse button reports whether the sidebar is expanded.                             |
| Dialogs (trust, tool permission, new run, retry, and others) | Focus moves inside when they open, to **Cancel** in the trust and permission dialogs. Esc closes them unless a save is in progress. Focus returns to the control that opened them, or to the page title if that control is gone. |
| Messages                                                     | Errors use alert regions, so they are announced at once. Success messages and the notice under the page header are announced politely.                                                                                           |
| Theme                                                        | **Switch to dark mode** and **Switch to light mode** are buttons with those names. The first visit follows your system setting.                                                                                                  |
| Effort                                                       | The slider reads its value as text ("Agent default", "High").                                                                                                                                                                    |
| Ticket number                                                | Enter in the **Ticket number** box runs **Retrieve**.                                                                                                                                                                            |

### Runs

| Where         | Keys and behaviour                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run graph     | Each step is a button announcing its name, status, attempt count and, when known, agent, model and effort. Arrow keys move between steps. Enter or Space selects one.                                                                       |
| Run inspector | A panel named **Run inspector**. Its close button is focused on open, and Esc closes it (except while the retry dialog is open). The tabs use Left and Right arrows to move and wrap around. The panel can be resized by dragging its edge. |
| Run activity  | New entries are announced politely as they appear.                                                                                                                                                                                          |

### Loops editor

| Where      | Keys and behaviour                                                                                                                                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor     | Esc closes the step drawer (unless a save is in progress). Ctrl+Z or Cmd+Z undoes; adding Shift redoes.                                                                                                                                                                                                        |
| Graph view | On a step card: **C** opens connect, **D** opens disconnect, Enter opens the step, and Alt with an arrow key moves focus to the nearest neighbouring step. Arrow keys on a selected step move it. Delete or Backspace removes the selected dependency while focus is inside the graph and not in a text field. |

### Layout

The sidebar stacks above the page on narrow windows and can collapse to an icon rail on wide ones. Your sidebar and theme choices are stored in your browser only; if storage is blocked they last until you reload.

## Files and folders Code Factory creates

### In your project

Everything lives under `.code-factory/`. It is never committed by Code Factory and does not count as an uncommitted change.

| Path                                         | Contents                                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.code-factory/project.json`                 | Project name, default agent binding, optional custom agent and setup command. Created by setup or by `code-factory init`; init never overwrites it. |
| `.code-factory/loops/<id>/draft.json`        | The working draft of a loop.                                                                                                                        |
| `.code-factory/loops/<id>/versions/<n>.json` | Published, immutable loop versions.                                                                                                                 |
| `.code-factory/runs/<run id>.json`           | A run: its snapshot (immutable), steps, attempts, events and evidence (append-only).                                                                |
| `.code-factory/gates/changed-files-gate.mjs` | Written before each step that uses the changed-files gates, so they keep working if `.code-factory/` is deleted.                                    |
| `.code-factory/workspaces/`                  | Only for runs created by older versions that used a private clone. New runs do not use it.                                                          |

`.code-factory` must be a real directory and `project.json` a real file; links are refused. Existing agent folders and instruction files (`.claude/`, `.kiro/`, `AGENTS.md`) are never overwritten by setup. Native import and export previews conflicts first and never silently replaces a file.

Run branches are ordinary Git branches in your repository. Starting a run creates one at your current commit and switches your checkout to it. Code Factory commits each successful writing step on that branch, never changes your Git configuration and never pushes.

### In your user folder

Trust and connection memory are stored outside every project.

| File               | Contents                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `trust.json`       | Projects you trust (by real path), when you trusted them, and per-provider tool permissions.                               |
| `connections.json` | Which agents you connected for each project. No credentials.                                                               |
| `trust.json.lock`  | Short-lived lock while one of the two files above is written. A lock older than ten seconds is treated as left by a crash. |

The folder is, in order of preference:

1. `CODE_FACTORY_HOME`, if set to an absolute path.
2. On Windows, `%APPDATA%\code-factory`.
3. `$XDG_CONFIG_HOME/code-factory`, if set to an absolute path.
4. `~/.config/code-factory`.

Relative values of these variables are ignored. A trust folder that is inside the project is refused. The folder is created readable only by you, and the files are written the same way.

Code Factory does not store agent credentials or your Linear key anywhere.

## Environment variables

Set these in the terminal that starts Code Factory.

| Variable                          | Used for                                                                                                          | Notes                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CODE_FACTORY_HOME`               | Overrides the user folder for `trust.json` and `connections.json`.                                                | Must be an absolute path and must not be inside the project.                                                                   |
| `CODE_FACTORY_LINEAR_API_KEY`     | Enables ticket retrieval from Linear in the new-run dialog.                                                       | Read once at start and removed from the environment, so agents and commands never see it. Never stored or returned by the API. |
| `CODE_FACTORY_COVERAGE_THRESHOLD` | Minimum line coverage, in percent, for the coverage gate of the **Gated implementation and six reviews** starter. | Default 90. Read by the gate script when it runs.                                                                              |
| `XDG_CONFIG_HOME`, `APPDATA`      | Where the user folder lives (see above).                                                                          | Must be absolute.                                                                                                              |
| `PATH`                            | Where Code Factory looks for `codex`, `kiro-cli`, `claude`, `cursor-agent` and `agent`.                           | Used by **Recheck agents** and at start.                                                                                       |
| `CODE_FACTORY_DEV_ORIGIN`         | Used by `pnpm dev` so the development UI is accepted as an allowed origin.                                        | For contributors only; you do not need it.                                                                                     |

Check steps receive two variables from Code Factory:

| Variable                     | Contents                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CODE_FACTORY_BASE_REVISION` | The commit the run started from.                                                                                                |
| `CODE_FACTORY_CHANGED_FILES` | One path per line: files the run added or modified (committed or not), excluding deletions, ignored files and `.code-factory/`. |

## Command-line reference

Run with `npx @thiagosbrito/code-factory <command>` or, if installed, `code-factory <command>`.

| Command                                     | What it does                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code-factory start`                        | Starts the local runtime and UI for the project and prints a link.                                                                                   |
| `code-factory init [directory]`             | Creates `.code-factory/project.json` in the folder (default: the current one). No agent, model or loop is chosen. Never overwrites an existing file. |
| `code-factory doctor`                       | Prints the agent executables found on your PATH as JSON. It does not launch them. Detection does not prove identity, sign-in or capabilities.        |
| `code-factory --version` (`-v`)             | Prints the installed version.                                                                                                                        |
| `code-factory --help` (`-h`), or no command | Prints usage.                                                                                                                                        |

Flags for `start`:

| Flag                    | Meaning                                              | Default                                              |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `--project <directory>` | The project folder to work in.                       | The current folder.                                  |
| `--port <number>`       | Port to listen on, 0 to 65535. `0` picks a free one. | `4310`                                               |
| `--no-open`             | Do not open the browser.                             | Opens automatically only in an interactive terminal. |

Code Factory needs Node 22.12 or newer. It listens on `127.0.0.1` only. The printed link carries a token that changes on every start: the first visit stores it in a cookie and removes it from the address bar. Press Ctrl+C to stop. The project must be the root of a Git repository with at least one commit to run work.

## Troubleshooting

### Starting and opening

| Symptom                                                                          | Cause                                                                                                                                   | Fix                                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| "Code Factory needs Node 22.12 or newer (you have X)."                           | Node is too old.                                                                                                                        | Install Node 22.12 or newer.                          |
| "Port 4310 is already in use. Pick another with --port, or use --port 0."        | Another process (perhaps another Code Factory) holds the port.                                                                          | Use `--port 0` or another number.                     |
| "Port N cannot be used (permission denied). Try --port 0."                       | The port is reserved.                                                                                                                   | Use `--port 0`.                                       |
| "Port must be between 0 and 65535; 0 selects an available port."                 | Invalid `--port` value.                                                                                                                 | Pass a whole number in range.                         |
| "Unknown command: X"                                                             | Mistyped command.                                                                                                                       | Use `start`, `init` or `doctor`.                      |
| "Project path does not exist: …" or "Project path is not a directory: …"         | Wrong `--project`.                                                                                                                      | Pass an existing folder.                              |
| "Cannot access project path…" / "Cannot read and write project directory…"       | Folder permissions.                                                                                                                     | Fix permissions, or choose another folder.            |
| **Cannot open project** page with a **Retry** button                             | The page could not load the project, for example after Code Factory was stopped.                                                        | Check the terminal, restart it, then press **Retry**. |
| "Open Code Factory from the link `code-factory start` printed in your terminal." | The page has no session cookie, for example it was opened without the link, or Code Factory was restarted (each start has a new token). | Open the newest link printed by `start`.              |
| "This link is not for the running Code Factory. Use the link it printed."        | An old link from a previous start.                                                                                                      | Use the link from the current terminal.               |
| "Unrecognized host" or "Unrecognized origin"                                     | The page was opened with another address (not `127.0.0.1` or `localhost` on the right port) or from another site.                       | Use the printed link as it is.                        |
| "Agent discovery is unavailable. You can finish setup and recheck later."        | The runtime could not scan for agents.                                                                                                  | Finish setup, then press **Recheck agents**.          |

### Setup and agents

| Symptom                                                                             | Cause                                                                                                                                                                                                                                                                       | Fix                                                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Agent card says **Not detected** or "Executable not found"                          | The program is not on the PATH of the terminal that started Code Factory.                                                                                                                                                                                                   | Install it, or start Code Factory from a shell where it is on PATH, then **Recheck agents**.                    |
| "`<provider>` executable is not detected. Install it and recheck."                  | You tried to connect an agent that was not found.                                                                                                                                                                                                                           | Install it and press **Recheck agents**.                                                                        |
| "Authentication required. Sign in with the selected agent CLI, then recheck."       | The agent is installed but signed out.                                                                                                                                                                                                                                      | Sign in with the agent's own CLI, then **Recheck connection**. Code Factory never takes a login.                |
| "Connection verification failed: …"                                                 | The agent launched but its identity, sign-in or catalog check failed. The text after the colon is the agent's own reason (for example "kiro-cli whoami --format json did not print a Kiro identity" or "claude auth status --json did not print an authentication status"). | Run the same command in a terminal to see why; update or sign in to the agent; try **Verify connection** again. |
| "Executable is not a supported Codex CLI" / "Kiro CLI" / "Claude Code CLI"          | The program found is not the expected tool or version.                                                                                                                                                                                                                      | Install the genuine CLI.                                                                                        |
| "Identity or protocol handshake did not verify the selected CLI."                   | The executable did not behave as the chosen protocol.                                                                                                                                                                                                                       | Pick the right executable (for **Custom**, a Codex-compatible one).                                             |
| "A newer connection request for this agent replaced this one."                      | You verified the same agent twice in a row.                                                                                                                                                                                                                                 | Nothing; the newer request applies.                                                                             |
| "Enter an absolute executable path." / "Enter an absolute custom executable path."  | The **Custom executable** is not an absolute path.                                                                                                                                                                                                                          | Type a full path such as `/usr/local/bin/codex`.                                                                |
| "Custom executable must be an accessible executable file."                          | The path is missing, is a folder, or is not executable.                                                                                                                                                                                                                     | Check the path and permissions.                                                                                 |
| "Verify the current custom executable before saving its default."                   | The path was changed after the last verification.                                                                                                                                                                                                                           | Press **Verify connection** again before saving.                                                                |
| **Project default** shows a red line after a restart                                | The agent is not connected yet, or its catalog changed.                                                                                                                                                                                                                     | Wait for the connection to return, or **Edit project setup** and choose again.                                  |
| "Project setup changed on disk. Reload and try again."                              | `project.json` changed while the form was open.                                                                                                                                                                                                                             | Reload the page and edit again.                                                                                 |
| "Invalid project configuration at …/project.json. Repair it before saving setup."   | The file does not match the expected format.                                                                                                                                                                                                                                | Fix or delete the file, then open setup again.                                                                  |
| "`<folder>` must be a regular directory." / "`<path>` must be a regular file."      | `.code-factory` or `project.json` is a link or the wrong kind of item.                                                                                                                                                                                                      | Replace it with a real folder or file.                                                                          |
| "Cannot save project configuration in … Check write permissions." / "Disk is full." | Folder not writable or no space.                                                                                                                                                                                                                                            | Fix permissions or free space.                                                                                  |
| "Close the quote in the setup command."                                             | An unclosed `'` or `"`.                                                                                                                                                                                                                                                     | Close the quote.                                                                                                |
| "Enter a project name."                                                             | **Project name** is empty.                                                                                                                                                                                                                                                  | Type a name.                                                                                                    |

### Trust and permissions

| Symptom                                                                                                                                                 | Cause                                                                                | Fix                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| "Trust this project before Code Factory runs anything in it."                                                                                           | Execute, retry, or an agent executable inside the project was tried before trusting. | Press **Execute run** and answer the **Trust this project?** dialog, or use **Trust project…** in setup. |
| **Allow…** is disabled with "Trust the project first"                                                                                                   | The project is not trusted.                                                          | Trust it first.                                                                                          |
| "A project can only be trusted from the Code Factory UI." / "Tool permission can only be granted from the Code Factory UI."                             | The request did not come from the Code Factory page.                                 | Use the buttons in the app.                                                                              |
| "Connection lost. The project was not trusted; try again." / "The permission was not saved; try again."                                                 | The runtime was unreachable while saving.                                            | Check Code Factory is running and try again.                                                             |
| "Invalid trust file at …/trust.json. Repair or remove it."                                                                                              | The file is corrupt. Code Factory will not reset it.                                 | Repair it, or remove it (this forgets all trust and permissions) and trust again.                        |
| "Invalid connections file at …/connections.json. Repair or remove it."                                                                                  | Same, for remembered connections.                                                    | Repair or remove it, then reconnect agents.                                                              |
| "Another Code Factory process holds …trust.json.lock. Try again, or remove the file if no Code Factory is running."                                     | Another instance is writing, or a crash left the lock.                               | Try again; if no Code Factory is running, delete the lock file.                                          |
| "Code Factory's trust folder … is inside this project, which could then trust itself. Set CODE_FACTORY_HOME to an absolute folder outside the project." | `CODE_FACTORY_HOME` (or your config folder) is within the project.                   | Point it outside the project.                                                                            |
| "Tool permissions saved in this project's files are ignored; grant them again here."                                                                    | `project.json` contains `toolGrants`.                                                | Use **Allow…** in setup. This is by design.                                                              |
| A run's shell commands are refused                                                                                                                      | The provider's tool permission is not granted.                                       | Use **Allow…** under **Agent tool permission**, or choose **Allow and run** when asked.                  |

### Runs and Git

| Symptom                                                                                                                                                                    | Cause                                                               | Fix                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| "The project has uncommitted changes. Commit or stash them yourself, then start the run again; Code Factory never stashes, resets or cleans your files."                   | The working tree is not clean when a run starts or executes.        | Commit or stash your changes.                                                                                     |
| "A merge, rebase, cherry-pick, revert or bisect is in progress in the project. Finish or abort it first."                                                                  | Git is in the middle of an operation.                               | Finish or abort it.                                                                                               |
| "The project has no commits yet. Make a first commit, then start the run."                                                                                                 | Empty repository.                                                   | Commit once.                                                                                                      |
| "The selected project must be the root of a Git repository."                                                                                                               | The folder is not a Git root.                                       | Start Code Factory with `--project` set to the repository root.                                                   |
| "Configure Git user.name and user.email for this repository. Code Factory never changes Git config."                                                                       | No Git identity.                                                    | Run `git config user.name` and `git config user.email`.                                                           |
| "Branch X already exists. Choose another name; Code Factory never reuses or overwrites a branch."                                                                          | The run branch name is taken.                                       | Use the suggested name or type another in the new-run dialog.                                                     |
| "`<name>` is not a valid branch name."                                                                                                                                     | Git rejects the name.                                               | Choose another.                                                                                                   |
| "The project is on branch X, not on run branch Y. Switch back with `git switch Y` to continue this run."                                                                   | You changed branches while the run was pending or active.           | Run `git switch` to the named branch. Code Factory never switches back for you.                                   |
| "A reviewer or check changed project files earlier in this run, and the project still has uncommitted changes. Review, commit or discard them yourself before continuing…" | A read-only step modified files. Nothing is reverted automatically. | Review, commit or discard the changes, then continue.                                                             |
| "Reviewer changed project files, so its result does not describe the committed candidate."                                                                                 | A reviewer or check wrote to the project.                           | Inspect the listed files and discard or keep them, then retry.                                                    |
| "Configure a tracker before retrieving tickets."                                                                                                                           | No Linear key was given at start.                                   | Start Code Factory with `CODE_FACTORY_LINEAR_API_KEY`, or type the ticket number without retrieving.              |
| "Tracker authentication failed. Check the configured connection."                                                                                                          | The Linear key is wrong or expired.                                 | Provide a valid key and restart.                                                                                  |
| "Tracker request failed. Retry retrieval."                                                                                                                                 | Network failure or Linear error (10 second limit).                  | Try again.                                                                                                        |
| "Ticket X was not found."                                                                                                                                                  | No such Linear issue.                                               | Check the number.                                                                                                 |
| "This request ID is already starting another run."                                                                                                                         | Two starts of the same request overlapped.                          | Wait a moment and look at **Runs**.                                                                               |
| A run is refused because another is pending or active                                                                                                                      | Only one run holds the project at a time.                           | Finish the other run, or cancel it (**Cancel run**).                                                              |
| "Run revision conflict; reload before updating."                                                                                                                           | The run changed in another tab.                                     | Reload the page.                                                                                                  |
| After a restart, a run is not progressing                                                                                                                                  | A restart never resumes anything on its own.                        | Use **Resume run**; an attempt only continues if its agent supports recovery, otherwise it is marked interrupted. |

## FAQ

**Does Code Factory send my code anywhere?** Code Factory itself only listens on your own machine. The agents you connect (Codex, Kiro, Claude Code) are separate programs with their own network behaviour and logins. The only outgoing request Code Factory makes is a ticket lookup to Linear when you supplied a key.

**Where are my agent passwords?** Code Factory never stores them. Each agent keeps its own login, and Code Factory only asks the agent whether it is signed in.

**Why does it ask me to trust a project?** A cloned project can contain commands. Until you trust it, Code Factory runs none of them. The dialog lists them so you can read first.

**Does trusting a project let agents run shell commands?** No. That is the separate, per-provider tool permission. By default agents cannot run shell commands for you (Codex still runs commands inside its sandbox).

**How do I take trust or a permission back?** In **Settings**, **Edit project setup**, **Agent tool permission**: **Revoke** for a permission, **Stop trusting** for the project. Stopping trust also removes the permissions and cancels the runs being executed.

**Do trust decisions follow the project if I move it?** No. They are keyed by the project's real path in your user folder, so a moved or renamed folder asks again.

**Why do I have to reconnect after changing a setting?** Connections last for the session and are restored automatically at the next start. A changed **Custom executable** must be verified again.

**Can I use more than one agent?** Yes. Connect as many as you like; each step uses the agent bound to it. Each provider asks about tool permission separately.

**Can I change the model of a run that already exists?** No. Bindings are frozen in the run's snapshot. Change the project default or a loop step for future runs.

**Why is there no Effort slider?** The chosen model offers no levels. Kiro never does; for others, pick a model that lists them.

**Can I run two runs at once?** Not in the same project. Runs use your own checkout, so one run holds the project at a time.

**Is anything pushed to a remote?** No. Code Factory creates branches and commits locally and never pushes.

**What does the demo change?** Nothing. Demo content is separate from your project and never saved.

**How do I change which folder Code Factory uses?** Stop it and start it again with `--project <folder>`.

**Where do I report a security problem?** Privately, through a GitHub security advisory on the Code Factory repository. Do not open a public issue.

**Is Windows supported?** The paths and shell handling are written to work, but Windows is untested overall.
