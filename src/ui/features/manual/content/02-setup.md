# Setup

The Setup screen configures the project Code Factory is attached to. It appears automatically the first time you open a project that has no saved setup, titled **Connect your first project**. For a project that already has a setup, it opens in edit mode, titled **Edit project setup**. The side panel reads **First-use setup** or **Project setup** accordingly.

The screen is a single form with sections in this order:

1. **Project**
2. **Coding agent**
3. **Agent tool permission** (shown only for a project that already has a saved setup)
4. **Default model**

Below them are the form buttons. Nothing is saved until you press **Finish setup** (first use) or **Save project** (edit mode).

## Project

Local workspace selected when Code Factory started.

| Control                      | What it does                                                                                                                                                                            | What changes                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Project name**             | The display name of the project. It takes focus when the screen opens. Maximum 120 characters.                                                                                          | Saved in `.code-factory/project.json` and shown in the app. It does not rename the folder or repository.        |
| **Local project path**       | Read-only. Shows the canonical path of the workspace the runtime is attached to.                                                                                                        | Nothing. To use another workspace, restart Code Factory with `--project`.                                       |
| **Setup command (optional)** | A command run once in the project before the first step of each run, for example `pnpm install --frozen-lockfile`. It runs without a shell, so quote any argument that contains spaces. | Saved with the project. A failure stops the run before any agent step. Leave it empty to clear a saved command. |

How the setup command is read: the text is split on whitespace, and single or double quotes group words. There is no expansion, escaping, globbing, piping or variable substitution, because no shell is involved. If you open the screen later, a saved command is shown back in the same quoted form. Its exit code and the tail of its output are kept as run evidence. Because runs use your existing checkout and its installed dependencies, most projects do not need one. Setup commands count among the commands you are asked to trust before they run.

## Coding agent

Installation, authentication and capabilities are separate checks. Code Factory shows them separately because each can fail on its own.

### Agent cards

The first card is **No default agent** (**Configure later**). Choose it to finish setup without an agent. After it come one card per candidate agent: **Codex**, **Cursor**, **Kiro**, **Claude Code** and **Custom**. Each card shows a detail line and a status. Exactly one card is selected at a time.

| Status                  | What it means                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Not detected**        | No executable was found on your PATH, or discovery was unavailable. For **Custom**, no executable has been verified yet.                         |
| **Executable detected** | A program with the expected name was found. Nothing has been launched, so its identity, sign-in and capabilities are still unknown.              |
| **Identity verified**   | Code Factory launched the program, and it identified itself and completed its protocol handshake. It is not signed in, so it cannot be used yet. |
| **Connected**           | The program is verified and signed in. Its models and capabilities are now loaded, and it can run steps.                                         |

The detail line under the name gives the reason in plain words. Examples are **Executable not found**, **Detected; verification required**, an identity and version followed by **Connected**, or the same followed by **Authentication required**. **Cursor** is only ever detected: its detail reads that the connection adapter is not implemented, and it cannot be verified or used.

| Control                   | What it does                                                                                                                                 | What changes                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No default agent** card | Selects "no default".                                                                                                                        | The project is saved without a default model and effort. Runs cannot start from the project default until you choose an agent later.                                 |
| An agent card             | Selects that agent for the project default. For a detected agent that is not yet connected, it also starts the automatic connection (below). | Resets the **Project default model** to **Agent default** and clears the effort, because models and efforts belong to the agent. It also clears any displayed error. |

### Automatic connection

When you select a **Codex**, **Kiro** or **Claude Code** card, Code Factory connects it for you after a 500 ms pause. This happens only if all of these are true:

- the agent is not already connected,
- its executable was detected,
- it is not known to be signed out, and
- its previous automatic attempt did not fail.

During the pause the screen shows: "Connecting in a moment. Choose another option to cancel, or verify now." To cancel, select a different card (including **No default agent**). Choosing the same card again while it connects changes nothing. To skip the wait, press **Verify connection**.

If the automatic attempt fails, the error appears and choosing the same agent again does not retry it. Press **Verify connection** to try again. A signed-out agent is also never retried automatically.

You can connect several agents, one after another, and each keeps its own result. A connected agent is remembered for this project in `connections.json` in your user-level folder (see the Overview). On the next start Code Factory connects it again, following the same trust rules as a click on Verify. An agent that fails to reconnect stays disconnected without affecting the others.

### Connection buttons and messages

| Control                                                      | What it does                                                                                                                                                                                              | What changes                                                                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verify connection**                                        | Launches the selected agent's executable and checks its identity, protocol and sign-in. Shown for Codex, Kiro, Claude Code and Custom. For **Custom** it is disabled until an executable path is entered. | On success the card becomes **Connected** (or **Identity verified** if not signed in) and its model catalog and capabilities load. On failure an error is shown. |
| **Recheck connection**                                       | The same button, relabelled once the agent is verified. It verifies again.                                                                                                                                | Replaces the connection with a fresh result, for example after you sign in or update the agent.                                                                  |
| **Verifying…**                                               | The button's label while verification runs. It is disabled until it finishes.                                                                                                                             | Nothing until the result arrives.                                                                                                                                |
| **Recheck agents**                                           | Rediscovers which agent executables are on your PATH. It launches nothing and does not verify anyone.                                                                                                     | Updates the cards, for example after you install an agent. Shown as **Rechecking…** while it runs. Failure shows "Could not recheck agents. Try again."          |
| Capability tiles (**Streaming**, **Guidance**, **Recovery**) | Show what the selected agent supports. They read **Available**, **Unsupported**, **Unavailable until connected**, **Authentication required** or **Unknown for this connection**.                         | Informational. A control is offered elsewhere only when the agent supports it.                                                                                   |

The authentication notice, "Authentication required. Sign in with the selected agent CLI, then recheck. Credentials stay with the agent.", appears when the selected agent is installed but signed out. Sign in using that agent's own command-line tool, then press **Recheck connection**. Code Factory never asks for or stores your credentials.

If discovery itself fails, the screen shows "Agent discovery is unavailable. You can finish setup and recheck later." and lists the agents as not detected. Use **Recheck agents** later.

What each agent's check does:

| Agent           | How it is verified                                                                                               | Sign-in                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Codex**       | Starts the Codex app-server and reads its account and model list.                                                | Connected only when the Codex account is signed in.   |
| **Kiro**        | Reads Kiro's model catalog.                                                                                      | Reported as authenticated by its CLI session.         |
| **Claude Code** | Runs `claude auth status` and asks the CLI for the models its login can use.                                     | Connected only when `claude` reports it is logged in. |
| **Custom**      | Launches the executable you name and requires it to identify as Codex CLI and complete the app-server handshake. | Same as Codex.                                        |

### Custom agent

Selecting the **Custom** card shows two extra fields.

| Control               | What it does                                                                  | What changes                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Custom executable** | The absolute path to your executable (placeholder `/absolute/path/to/codex`). | Editing it resets the model to **Agent default**, clears the effort, and marks the custom agent as disconnected until you verify the new path. When verified, the path is replaced with its resolved location. |
| **Protocol**          | The only choice is **Codex app-server**.                                      | The saved custom agent always uses this protocol.                                                                                                                                                              |

Verification launches this executable only when you press **Verify connection**. The program must identify as Codex CLI and complete its protocol handshake. If the project's own files supply an executable, or the executable lives inside the project folder, Code Factory refuses to launch it until you trust the project.

The custom executable is saved with the project (in `.code-factory/project.json`) when you save the form, and a non-empty value must be an absolute path.

## Agent tool permission

This section appears only when editing a project that already has a saved setup. It controls two separate things: whether Code Factory may run anything in the project, and whether agents may run shell commands.

| Control                       | What it does                                                                                                                                                       | What changes                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trust project…**            | Opens a dialog listing every setup, check and custom agent command the project defines, and asks you to trust the project. Shown while the project is not trusted. | The decision is stored in `trust.json` in your user-level folder. Afterwards Code Factory can run steps in the project. The message "Project trusted. Code Factory can now run steps here." confirms it. |
| **Stop trusting**             | Removes your trust. Shown while the project is trusted. The line above it reads "trusted since" followed by the date.                                              | Removes the project's tool permissions too, and cancels runs being executed in it. Message: "Project no longer trusted. Its tool permissions were removed."                                              |
| **Allow…** (one per provider) | Opens a dialog asking you to allow the provider to run commands. Disabled, with the hint "Trust the project first", until the project is trusted.                  | Stores a grant for that provider and project in `trust.json`. New writing steps then use it.                                                                                                             |
| **Revoke**                    | Removes the provider's grant. Shown instead of **Allow…** once granted.                                                                                            | New steps use the default tools again. Message: "… revoked. New steps use the default tools."                                                                                                            |

There is one row for each of **Kiro**, **Codex** and **Claude Code**. Each row states the current state:

| Provider        | Default (no grant)                              | Granted                                          |
| --------------- | ----------------------------------------------- | ------------------------------------------------ |
| **Kiro**        | default tools only (fs_read, fs_write)          | shell (execute_bash) allowed since a date        |
| **Codex**       | default: command approval requests are declined | commands inside the project allowed since a date |
| **Claude Code** | default: file tools only, Bash denied           | shell (Bash) allowed since a date                |

Notes:

- Reviewer steps stay read-only even when a grant exists.
- A grant lets an allowed command run in your checkout with your account's permissions, so it can change your files, branches and Git configuration.
- A `toolGrants` entry written into the project's own files is ignored. When one is present the section says: "Tool permissions saved in this project's files are ignored; grant them again here."
- If a request to change trust or a permission fails, the dialog or section shows the error, for example "Connection lost. The project was not trusted; try again."
- The same questions are also asked the first time you execute or retry a run.

## Default model

Used for future runs. Existing run snapshots retain their bindings.

The default model and effort are the project's default **binding**. A loop step that has no binding of its own inherits it. A step that sets its own binding overrides it. When you create a run, the choice is resolved once into the run's snapshot, so later changes affect only new runs. A project with no default cannot start runs from it, because no agent is preselected.

| Control                                       | What it does                                                                                                                                      | What changes                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project default model** (dropdown)          | Lists **Agent default**, then each model the connected agent reports. Disabled until the selected agent is connected.                             | Choosing a model resets the effort to **Agent default** and marks the default as changed. It shows the model's description when it has one.                               |
| **Custom model…** option and the model id box | For agents that accept any model name, an extra option lets you type a model id or alias (placeholder "Model id or alias, e.g. claude-opus-5-5"). | The typed id becomes the default once it is non-blank. While the box is empty the previous value is kept, and the hint says the agent default is used until you type one. |
| **Effort** (slider)                           | Shown only if the chosen model offers effort levels. See below.                                                                                   | Saved as the default effort. Each step inherits it unless it sets its own.                                                                                                |

The help text under the dropdown tells you the state:

- "Models come from this connection's catalog; listing does not guarantee entitlement." means the agent is connected. A listed model may still be unavailable to your account.
- "Saved default is retained until you change it." means the agent is not connected right now, but a default is already saved. It stays until you change it.
- "Connect an agent to load its catalog." means nothing is saved and no agent is connected.

If a saved model is no longer in the connected agent's catalog, it stays in the list as `<id> (unavailable)`, so nothing is dropped silently.

### What each agent offers

| Agent           | Models                                                                                                                                                | Custom model id                    | Effort levels                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Codex**       | The visible models Codex reports for your account.                                                                                                    | Not offered.                       | The reasoning efforts Codex lists for each model. A model that lists none shows no slider.               |
| **Kiro**        | The models in Kiro's own catalog.                                                                                                                     | Not offered.                       | None. Kiro does not advertise effort choices, so no slider appears and a step with an effort is refused. |
| **Claude Code** | The models the CLI reports for your login. If it cannot list them: **Fable (latest)**, **Opus (latest)**, **Sonnet (latest)** and **Haiku (latest)**. | Offered through **Custom model…**. | low, medium, high, xhigh and max, for each listed model, for **Agent default** and for custom ids.       |
| **Custom**      | Same as Codex, as reported by your executable.                                                                                                        | Not offered.                       | As reported by your executable.                                                                          |

Effort levels are checked against what the connection reports, so a saved effort the model no longer supports is rejected (see Errors).

### Effort slider

The slider moves from the lightest to the heaviest level, in the order the agent lists them. The label above it shows the current stop, and labels beneath show every stop.

- The first stop, **Agent default** (labelled **Default** beneath the slider), leaves the effort unset. The agent then uses its own default. No effort is sent to it.
- The other stops are the agent's levels, capitalised, for example **Low**, **Medium**, **High**, **Xhigh** and **Max** for Claude Code.
- A saved level the agent no longer lists is kept as a last stop labelled `<Level> (unavailable)`, so it is visible rather than silently dropped.
- The slider can be used from the keyboard with the arrow keys.
- Changing the model always resets the slider to **Agent default**, because the available levels depend on the model.

## Buttons and saving

| Control               | What it does                                                                     | What changes                                                                                            |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Finish setup**      | First-use only. Validates and saves the setup. Reads **Saving…** while it works. | Creates or updates `.code-factory/project.json` and opens the factory.                                  |
| **Save project**      | The same action in edit mode.                                                    | Updates the saved setup and returns to the factory.                                                     |
| **Cancel**            | Edit mode only. Leaves without saving.                                           | Nothing is saved. The agents you connected in this session remain connected.                            |
| **Open demo factory** | First-use only. Opens a sample factory so you can explore the layout.            | Nothing is saved or created, and no project history is made. The screens show sample placeholders only. |

The default model and effort are written only if you actually changed the agent, model or effort in this visit. Otherwise the saved default is kept untouched. The custom agent is saved when its field is not empty. The setup command is sent only when it differs from what was saved: an empty field clears a saved command, and an unchanged field leaves it alone.

Saving uses a revision check: if `.code-factory/project.json` changed on disk since the screen loaded, the save is refused so that you never overwrite someone else's edit. Reload and try again.

## Validation errors

Errors appear in a red box above the buttons, or under the model fields.

| Message                                                                                       | Cause and fix                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter a project name.                                                                         | **Project name** is blank. Type a name (up to 120 characters).                                                                                                                                     |
| `<provider>` binding is unavailable until its connection is verified and authenticated.       | You selected an agent and changed the default, but it is not **Connected**. Press **Verify connection**, sign in with the agent if needed, then save. Or choose **No default agent**.              |
| Model `<id>` is unavailable in the current catalog.                                           | The model is not in the connected agent's list, and the agent does not accept custom ids. Pick a listed model or **Agent default**.                                                                |
| Effort `<level>` is unavailable for this model.                                               | The effort is not offered for the chosen model. Move the slider to a listed stop or **Agent default**.                                                                                             |
| Enter an absolute custom executable path.                                                     | **Custom executable** does not start with `/`. Enter the full path.                                                                                                                                |
| Close the quote in the setup command.                                                         | The **Setup command (optional)** has an unmatched `'` or `"`.                                                                                                                                      |
| Connection verification failed: …                                                             | Verification could not complete. The rest of the message says why, such as a missing executable, a failed handshake or a newer request replacing this one. Fix it and press **Verify connection**. |
| `<provider>` executable is not detected. Install it and recheck.                              | The agent's program is not on your PATH. Install it and press **Recheck agents**.                                                                                                                  |
| Enter an absolute executable path. / Custom executable must be an accessible executable file. | The custom path is relative, missing, not a regular file, or not executable.                                                                                                                       |
| Project setup changed on disk. Reload and try again.                                          | Another process modified `.code-factory/project.json` while you were editing. Reload the page, then repeat your change.                                                                            |
| Could not save setup. Try again.                                                              | The save failed for a reason the runtime did not describe. Try again.                                                                                                                              |

Validation of the model and effort is skipped when you have not changed the binding in this visit. A previously saved default that has since become unavailable does not block you from saving other changes, such as the project name.

## What changes downstream

| If you change…                       | Then…                                                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The selected agent                   | The model and effort reset. The list of models, the custom-id option and the effort levels all come from the new agent. Steps with no binding of their own will use the new agent for future runs. |
| The model                            | The effort resets to **Agent default**, and the levels offered change with the model.                                                                                                              |
| The effort                           | Steps without their own effort inherit it for future runs. **Agent default** sends no effort.                                                                                                      |
| Connecting or disconnecting an agent | The model catalog, effort levels and capability tiles refresh. Run creation requires the agent to be connected and the chosen model and effort to exist in its catalog.                            |
| The setup command                    | It runs before the first step of every new run. A failing command stops the run, and a project must be trusted before it runs.                                                                     |
| Trust or tool permissions            | Take effect at once and need no save. Without trust, nothing runs. Without a grant, writing steps cannot run shell commands.                                                                       |
| Anything, for runs already created   | Nothing. Run snapshots keep the bindings they were created with.                                                                                                                                   |
