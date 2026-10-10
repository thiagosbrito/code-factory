# The workspace and Settings

This chapter covers the frame around everything you do in Code Factory: the sidebar, the page header, the Settings screen, the setup form behind **Edit project setup**, project trust, agent tool permissions, ticket retrieval, and the demo workspace.

## The app shell

When your project is configured, every screen shares the same layout: a dark sidebar on the left (stacked above the page on a narrow window) and the page itself on the right. The page starts with a header that names the screen.

If the project has not been set up yet, you see the setup form instead (see [Setup form](#the-setup-form)). Once you save it, the shell appears.

### The sidebar

| Control                                   | What it does                                                                                                            | What changes                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Brand mark                                | Shows the Code Factory logo. Hovering it shows `code-factory · <project name> · Local workspace` (or `Demo workspace`). | Nothing.                                                                                                             |
| **PROJECT** card                          | Shows the project name and, beneath it, **Local workspace** (or **Demo workspace** in the demo).                        | Nothing. Hidden when the sidebar is collapsed.                                                                       |
| **Runs**                                  | Opens the Runs screen.                                                                                                  | The page switches to Runs and any notice at the top of the page is cleared.                                          |
| **Loops**                                 | Opens the Loops screen.                                                                                                 | The page switches to Loops and any notice is cleared.                                                                |
| **Settings**                              | Opens the Settings screen.                                                                                              | The page switches to Settings and any notice is cleared.                                                             |
| Run count                                 | A number on the right of **Runs** showing how many runs the project has. In the demo it always reads 2.                 | Updates as runs are created. Screen readers announce it as "N runs" (or "1 run") when they read the **Runs** button. |
| Theme toggle                              | A sun or moon button. Its name is **Switch to dark mode** or **Switch to light mode**.                                  | Flips between the light and dark themes. The choice is remembered in this browser.                                   |
| **Exit demo**                             | Shown only in the demo workspace.                                                                                       | Leaves the demo and returns to your project.                                                                         |
| Availability notice                       | In a normal project the sidebar footer reads **Agent execution requires verified availability**.                        | Nothing. It is a reminder that an agent must be connected and verified before work can run.                          |
| **User manual**                           | A book icon at the bottom of the sidebar, above the collapse button; icon only when the sidebar is collapsed.           | Opens this manual in the main area. It works in the demo too, and nothing in your project changes.                   |
| **Collapse sidebar** / **Expand sidebar** | A panel icon at the bottom of the sidebar, on wide windows only.                                                        | Shrinks the sidebar to an icon rail or restores it. The choice is remembered in this browser.                        |

The current screen is marked as the active page (it is highlighted, and screen readers hear it as the current page).

#### The collapsed rail

When you collapse the sidebar:

- The **PROJECT** card disappears and the three navigation entries become icons. Their names stay **Runs**, **Loops** and **Settings** in tooltips and for screen readers. The **Runs** tooltip includes the count, for example `Runs (3)`, and a small badge shows the count when it is above zero.
- The theme toggle stays.
- In a normal project the availability notice shrinks to an information icon. Hover it, or use a screen reader, to read **Agent execution requires verified availability**.
- In the demo, **Exit demo** becomes an icon button with the same name.

The collapse button only exists on wide windows. On a narrow window the sidebar is always full width and stacked above the page, so a rail you saved on a desktop never leaves a small window without labels.

### The page header

| Control               | What it does                                                                                                  | What changes                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title                 | Names the screen: **Runs**, **Loops** or **Settings**.                                                        | Receives keyboard focus every time you change screen, so screen readers announce where you are.                                                                                                                                  |
| Subtitle              | One line under the title.                                                                                     | Runs: "Launch and review repeatable coding work." Loops: "Reusable local workflows for future runs." Settings: "Project and connection settings".                                                                                |
| **New run**           | Shown on the Runs screen only, and not in the demo. Opens the new-run dialog.                                 | A dialog opens. Nothing is created until you confirm there.                                                                                                                                                                      |
| **Open demo factory** | Shown on every screen except in the demo.                                                                     | Switches to the demo workspace (see [The demo workspace](#the-demo-workspace)).                                                                                                                                                  |
| Demo banner           | In the demo: **Demo factory · Sample content is separate from your project and is never saved.**              | Nothing.                                                                                                                                                                                                                         |
| Notice                | A bordered line that appears under the header after some actions. It is announced politely by screen readers. | Cleared when you click **Runs**, **Loops** or **Settings** in the sidebar. For example, **Use starter template** on an empty Runs screen takes you to Loops and shows "Choose a starter in the loops library to create a draft." |

When a project has no runs, the Runs screen shows **No runs yet** with two buttons: **Create loop** (goes to Loops) and **Use starter template** (goes to Loops and shows the notice above).

## The Settings screen

Settings is a single card. It is a summary and a launch point; the editable fields live in the setup form.

| Control                             | What it does                                                                                                                                                                                                                                                                                                               | What changes                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Project**                         | Shows the project name and, below it, the folder path Code Factory is attached to.                                                                                                                                                                                                                                         | Nothing.                                                            |
| Explanatory line                    | "Agent execution requires a verified connection. Project setup does not start a run."                                                                                                                                                                                                                                      | Nothing.                                                            |
| **Coding agents and default model** | One small card per agent Code Factory knows (Codex, Cursor, Kiro, Claude Code, Custom). Each shows the agent name and one status line.                                                                                                                                                                                     | Nothing. Re-check agents from the setup form.                       |
| Agent status line                   | One of: the reason Code Factory gives (for example "Discovery unavailable. Recheck to read local adapter results."), **Executable not found**, `<identity> <version> · Connected`, `<identity> <version> · Authentication required`, **Detected; verification required**, or **Detected; connection adapter unavailable**. | Reflects the connections of the current Code Factory session.       |
| **Project default**                 | Shows `provider · model · effort` for the saved default, or **Not configured**.                                                                                                                                                                                                                                            | Nothing. Change it in the setup form.                               |
| Red alert line                      | Appears under **Project default** when the saved default cannot be used right now: "`<provider>` binding is unavailable until its connection is verified and authenticated.", "Model `<model>` is unavailable in the current catalog." or "Effort `<effort>` is unavailable for this model."                               | Tells you to reconnect the agent or choose another model or effort. |
| **Edit project setup**              | Opens the setup form. Not shown in the demo.                                                                                                                                                                                                                                                                               | The shell is replaced by the setup form until you save or cancel.   |

Agent connections last for the session. Code Factory remembers which agents you connected for each project and connects them again at the next start, so the status lines usually return to **Connected** by themselves. If an agent is not connected when you try to run work, you see "`<provider>` is not connected in this Code Factory session (verified connections last until the runtime restarts). Verify it in Settings, then retry this step."

## The setup form

The same form is used twice. On first use (no saved project configuration) it is titled **Connect your first project** and ends with **Finish setup**. From Settings it is titled **Edit project setup** and ends with **Save project**; there it also has **Cancel**. Its sidebar shows **Project setup** or **First-use setup**.

Setup saves its choices under `.code-factory/project.json` in your project. It never starts a run.

### 1. Project

| Control                      | What it does                                                                                                                                                                               | What changes                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project name**             | The display name used in the sidebar and dialogs. Required (up to 120 characters).                                                                                                         | Saved in `project.json`. Saving with it empty shows "Enter a project name." and focuses the field.                                                                                                      |
| **Local project path**       | Read-only. Shows the real path of the folder Code Factory was started in.                                                                                                                  | Nothing. To use another folder, stop Code Factory and start it again with `--project`.                                                                                                                  |
| **Setup command (optional)** | A command that runs once in the project before the first step of each run. It runs without a shell, so quote arguments that contain spaces (for example `pnpm install --frozen-lockfile`). | Saved as a list of arguments. Clearing the field removes the command. An unclosed quote shows "Close the quote in the setup command." Because runs use your existing checkout, most projects need none. |

A setup command is code from the project, so it only runs after you [trust the project](#project-trust).

### 2. Coding agent

| Control                                                         | What it does                                                                                                                                                                                                       | What changes                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **No default agent**                                            | Chooses no default. Selected by default on a brand-new project.                                                                                                                                                    | The project has no default agent; you can still finish setup.                                                                                                                                                                                                                                                |
| Agent cards                                                     | One per agent: **Codex**, **Cursor**, **Kiro**, **Claude Code**, **Custom**. Each shows a status line and a state: **Connected**, **Identity verified**, **Executable detected** or **Not detected**.              | Choosing an installed, not-yet-connected, signed-in agent starts connecting it after half a second. Choosing another card within that pause cancels it ("Connecting in a moment. Choose another option to cancel, or verify now."). Choosing an agent clears the model and effort back to **Agent default**. |
| **Custom executable**                                           | Shown when **Custom** is selected. An absolute path to an executable, for example `/absolute/path/to/codex`.                                                                                                       | Used the next time you verify. Changing it clears the shown connection until you verify again.                                                                                                                                                                                                               |
| **Protocol**                                                    | Shown with **Custom**. The only choice is **Codex app-server**.                                                                                                                                                    | Nothing else to choose.                                                                                                                                                                                                                                                                                      |
| **Verify connection** / **Recheck connection** / **Verifying…** | Launches the selected agent and checks that it identifies correctly, is signed in and reports its models. The label is **Recheck connection** once verified. For **Custom** it is disabled until you enter a path. | The agent becomes **Connected** (and is remembered for the next start), or an error appears. Launching the executable is the only time Code Factory starts it.                                                                                                                                               |
| **Recheck agents** / **Rechecking…**                            | Looks for the agent programs on your PATH again, without launching them.                                                                                                                                           | The cards refresh. Use it after installing an agent.                                                                                                                                                                                                                                                         |
| Capability tiles                                                | Three tiles for the selected agent: **Streaming**, **Guidance**, **Recovery**.                                                                                                                                     | Each reads **Available**, **Unsupported**, **Authentication required**, **Unavailable until connected** or **Unknown for this connection**.                                                                                                                                                                  |
| Authentication message                                          | "Authentication required. Sign in with the selected agent CLI, then recheck. Credentials stay with the agent."                                                                                                     | Appears when the agent is installed but signed out. An agent that failed or is signed out is not retried automatically; use **Verify connection**.                                                                                                                                                           |

Code Factory never stores an agent's credentials. Each agent keeps its own login.

### 3. Default model

| Control                   | What it does                                                                                                                                                   | What changes                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project default model** | A drop-down of **Agent default**, the models in the connected agent's catalog, and (for agents that accept any model name) **Custom model…**.                  | Becomes the default for new runs. Existing runs keep the bindings in their snapshots. Disabled until the agent is connected; a saved default is kept until you change it.                     |
| Custom model id           | The text box that appears with **Custom model…**. Placeholder: "Model id or alias, e.g. claude-opus-5-5".                                                      | While empty, "Enter a model id, or choose another option. Until then the agent default is used."                                                                                              |
| **Effort**                | A slider whose first stop is **Agent default**, then the levels the agent lists for that model, lightest to heaviest. Shown only when the model offers levels. | Choosing a level saves it with the default. A saved level the agent no longer lists stays as a last stop labelled "(unavailable)". Changing the model resets the slider to **Agent default**. |
| Red alert                 | Shown when the draft cannot work, with the same three sentences as the Settings alert.                                                                         | Saving a changed default is blocked until fixed.                                                                                                                                              |

The reference chapter explains how agents, models and effort differ by provider. Listing a model does not guarantee your account may use it.

### Saving

| Control                                           | What it does                                                                             | What changes                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Save project** / **Finish setup** / **Saving…** | Saves the name, setup command, custom agent and (if you changed it) the default binding. | The shell returns. If the file changed on disk since you opened the form, you see "Project setup changed on disk. Reload and try again." |
| **Cancel**                                        | Only when editing. Discards the draft.                                                   | You return to the shell.                                                                                                                 |
| **Open demo factory**                             | Only on first use. Opens the demo without saving anything.                               | See below.                                                                                                                               |

## Project trust

A project's `.code-factory` folder can come with a clone, so its loops, check commands, setup command and runs may be someone else's. Code Factory therefore runs nothing in a project until you trust it.

### What is blocked until you trust the project

- Running a step, executing a run, retrying a step, and resuming a run. These fail with "Trust this project before Code Factory runs anything in it."
- Setup and check commands.
- Any agent executable that is the project's own: the custom executable saved in the project, or any executable inside the project folder (for example a committed `node_modules/.bin/claude`).
- Granting tool permissions (the **Allow…** buttons are disabled with the tooltip "Trust the project first").

Browsing the app, editing loops and setup, and verifying an agent installed elsewhere on your machine do not need trust.

### Where you are asked

You are asked once, the first time you press **Execute run** or retry a step in an untrusted project, and you can also decide ahead of time in the setup form (section 4, below). The question is the **Trust this project?** dialog.

| Part of the dialog              | What it shows                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Statement                       | "Code Factory will run this project's check and setup commands and start agents in it. Agents load the project's own settings, hooks and instructions. Only trust projects you wrote or reviewed."                                                                                                                                                                                                                                                                  |
| Command review                  | "This project's own files define:" followed by a list of every command trust would allow: the **Setup command**, **Setup command saved in a run of** a loop, the **Custom agent executable**, each **Check** step with its command, and a count of interrupted runs you can resume afterwards. If there are none: "This project defines no setup, check or custom agent commands yet." The list also includes commands saved in unfinished, failed or blocked runs. |
| Where it is saved               | "Saved for this folder in your own Code Factory settings, not in the project. Stop trusting it any time in Setup → Agent tool permission."                                                                                                                                                                                                                                                                                                                          |
| **Cancel**                      | Focused first. Closes the dialog; nothing is trusted and the run does not start.                                                                                                                                                                                                                                                                                                                                                                                    |
| **Trust project** / **Saving…** | Records your decision.                                                                                                                                                                                                                                                                                                                                                                                                                                              | Execution continues. If saving fails, an error appears in the dialog ("Connection lost. The project was not trusted; try again.") and you stay in it. |

Read the command list before you press **Trust project**. Trusting also means agents load the project's own `.claude/`, `.kiro/` and `AGENTS.md`-style instructions.

Trust can only be granted from the Code Factory page itself; a request from anywhere else is refused with "A project can only be trusted from the Code Factory UI."

### Reviewing and revoking trust

Open **Settings**, **Edit project setup**, and find section 4, **Agent tool permission** (shown once the project has a saved configuration).

| Control            | What it does                                                                                                                        | What changes                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trust status line  | **Project trust:** `trusted since <date and time>`, or `not trusted. Code Factory runs nothing in this project until you trust it.` | Nothing.                                                                                                                                                                                                                              |
| **Trust project…** | Shown when not trusted. Opens the dialog above.                                                                                     | On **Trust project**, the line reads "Project trusted. Code Factory can now run steps here."                                                                                                                                          |
| **Stop trusting**  | Shown when trusted. Takes effect immediately, with no confirmation.                                                                 | Removes the trust decision and every tool permission for this project, and cancels the runs Code Factory is executing in it (their evidence stays). The message reads "Project no longer trusted. Its tool permissions were removed." |

If the trust file cannot be read you see "Invalid trust file at `<path>`. Repair or remove it." Code Factory does not silently reset it.

## Agent tool permissions

By default agents cannot run shell commands for you. A tool permission, granted once per provider and reused until revoked, lets that provider run commands in your project.

| Provider        | Default                                                                                                                                    | After you allow it                                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kiro**        | Trusts only `fs_read` and `fs_write`. Row text: "default tools only (fs_read, fs_write)".                                                  | Adds `execute_bash` (`--trust-tools=fs_read,fs_write,execute_bash`). Row text: "shell (execute_bash) allowed since `<date>`".                                                                                                                                                      |
| **Codex**       | Runs commands inside its own sandbox; requests to go outside it are declined. Row text: "default: command approval requests are declined". | Accepts a command-approval request only when the command's working directory is inside the project folder. Network prompts and file-change approvals stay declined. Row text: "commands inside the project allowed since `<date>`". The command then runs outside Codex's sandbox. |
| **Claude Code** | File tools only, Bash denied (`--disallowedTools Bash`). Row text: "default: file tools only, Bash denied".                                | Starts steps with `--allowedTools Bash`. Row text: "shell (Bash) allowed since `<date>`".                                                                                                                                                                                          |

Cursor and Custom have no tool permission. Reviewers are always read-only whatever you grant: Kiro reviewers trust only `fs_read`, and Claude Code reviewers disallow Bash, Edit, Write and NotebookEdit.

An allowed command runs with your account's permissions and can change files, branches, stash and Git config in your checkout. The dialog says so; read it.

### Controls in the setup form

| Control              | What it does                                                                                                         | What changes                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One row per provider | Shows the provider name and its current state.                                                                       | Nothing.                                                                                                                                                                |
| **Allow…**           | Opens the consent dialog for that provider. Disabled until the project is trusted.                                   | After you confirm, the row shows the grant and the message "`<Kiro shell permission / Codex command permission / Claude Code shell permission>` allowed for new steps." |
| **Revoke**           | Removes that provider's permission immediately. Its accessible name is **Revoke Kiro shell permission** (and so on). | New steps use the default tools again. Message: "`<name>` revoked. New steps use the default tools." Focus moves to the replacement **Allow…** button.                  |

### The consent dialog

The dialog is titled **Allow Kiro to run shell commands?**, **Allow Codex to run commands outside its sandbox?** or **Allow Claude Code to run shell commands?**. It states the exact flags that will change and, in bold, what the permission lets the agent do. Its buttons:

| Button                                                                           | Where                                                       | What changes                                                                                                                             |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Cancel**                                                                       | Always, focused first.                                      | Closes the dialog; nothing is saved.                                                                                                     |
| **Allow**                                                                        | In the setup form.                                          | Saves the permission for this project.                                                                                                   |
| **Run without shell** (Kiro, Claude Code) or **Keep commands sandboxed** (Codex) | Only when the dialog appears as you execute or retry a run. | Runs with the default tools for this page session without saving anything. You are not asked again about that provider until you reload. |
| **Allow and run**                                                                | Only when the dialog appears as you execute or retry a run. | Saves the permission and continues the run.                                                                                              |

When you press **Execute run** or retry a step, Code Factory first asks about trust (if needed) and then asks once for each provider used by the run's agent steps that has no saved permission. Each attempt's evidence records which permission it used.

### Where permissions are stored

Trust decisions and tool permissions live outside every project, in a file named `trust.json` in your Code Factory user folder (see the reference chapter for its location). The folder and file are readable only by you. Because they are not in the project, a cloned repository cannot trust itself or grant its agents tools. If a project's own `project.json` contains a `toolGrants` entry, it is ignored, and the setup form says: "Tool permissions saved in this project's files are ignored; grant them again here."

Granting a permission also requires the Code Factory page: otherwise the request is refused with "Tool permission can only be granted from the Code Factory UI."

## Ticket retrieval and the Linear integration

Settings has no tracker panel. The tracker shows up in the new-run dialog (**New run**), in the **Ticket number** field.

- If a Linear API key was supplied to Code Factory when it started (the `CODE_FACTORY_LINEAR_API_KEY` environment variable), the **Retrieve** button is enabled. Type a ticket number such as `PROJ-123` and press **Retrieve** (or Enter) to load its title, description and attachments into the run.
- If no key was supplied, **Retrieve** is disabled and the dialog says: "The selected agent will read this issue through its configured issue tracker MCP (for example Jira or Linear) when the run starts. Connect it in that AI tool first." You can still type a ticket number; it is used for the run and the default branch name, but nothing is fetched.

The key is read once when Code Factory starts and then removed from its own environment, so agents and your check and setup commands never inherit it. It is never written to the project or returned by the API. To enable retrieval, stop Code Factory and start it again with the variable set.

Retrieval errors you may see: "Tracker authentication failed. Check the configured connection.", "Tracker request failed. Retry retrieval.", "Tracker returned an invalid response. Retry retrieval." and "Ticket `<ID>` was not found."

## The demo workspace

The demo is a sandbox for exploring the layout.

| Control                    | What it does                                                                                                   | What changes                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Open demo factory**      | In the page header (and on the first-use setup form).                                                          | Switches to the demo. The sidebar reads **Demo factory** and **Demo workspace**. |
| Runs and Loops in the demo | Show a card titled **Sample runs** or **Sample loops**: "Explore the layout without creating project history." | Nothing is created.                                                              |
| Settings in the demo       | Shows the same card as normal, without **Edit project setup**.                                                 | Nothing can be edited.                                                           |
| **Exit demo**              | In the sidebar.                                                                                                | Returns to your project, or to first-use setup if it has no configuration.       |

Demo content is separate from your project and never saved. The **New run** button and the dialogs that start real work are not available in the demo.

## Dialogs and keyboard

All dialogs in this chapter open with the safe choice (**Cancel**) focused, close with Esc unless a save is in progress, and return focus to the button that opened them. See the reference chapter for keyboard behaviour across the app.
