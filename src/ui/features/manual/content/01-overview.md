# Overview

Code Factory is a local, agent-independent coding loop factory. You describe a repeatable piece of work once, as a **loop** made of steps. Then you start **runs** of that loop against a task. A coding agent that you already have installed and signed in to (Codex, Kiro or Claude Code) performs each step. Code Factory decides what runs next, records what happened, and keeps the changes on a Git branch you can review.

Everything runs on your machine. Code Factory listens on `127.0.0.1` only, uses each agent's own login, and stores no agent credentials.

## How the pieces fit

Work flows through three areas of the app:

1. **Setup.** Name the project, connect a coding agent, and choose a default model and effort. See the Setup chapter.
2. **Loops.** Define the steps, their order, and their checks. A loop is saved as a draft and published as an immutable, numbered version.
3. **Runs.** Create a run from a published loop and a task description (optionally a Linear ticket). A new run is pending. You start it explicitly with **Execute run**.

Creating a run never starts an agent. Execution is always a separate action.

## Key concepts and glossary

| Term                 | Meaning                                                                                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project**          | The Git repository Code Factory was started in (or pointed to with `--project`). Its factory data lives in `.code-factory/`. Setup stores its display name.                                                                                               |
| **Loop**             | A portable, versioned definition of work: roles, instructions, steps, dependencies, groups, joins and decisions. It does not name a provider or model unless a step binds one.                                                                            |
| **Step**             | One unit of a loop. An agent step is carried out by a coding agent. A check step runs a command (see below).                                                                                                                                              |
| **Agent / provider** | The coding tool that performs agent steps: Codex, Kiro or Claude Code, or a custom executable that speaks the Codex app-server protocol. Cursor is detected but has no adapter yet, so it cannot be connected.                                            |
| **Model**            | The model the agent should use. **Agent default** leaves the choice to the agent itself. The list of models comes from the connected agent.                                                                                                               |
| **Effort**           | How much reasoning the model is asked to apply, on agents that offer levels. The first stop, **Agent default**, leaves it unset.                                                                                                                          |
| **Run**              | One execution of a published loop version against a task. It has its own steps, attempts, events and results.                                                                                                                                             |
| **Snapshot**         | The immutable copy of the task, the loop version, the resolved model and effort for each step, and the Git revision the run started from. Changing the project default later does not alter existing runs.                                                |
| **Evidence**         | The durable, append-only record of a run: attempts, events, outputs, command results and receipts. Failures keep their output as evidence.                                                                                                                |
| **Run branch**       | The Git branch Code Factory creates at your current commit when a run starts, and switches your checkout to. After each successful writing step Code Factory commits that step's changes on it.                                                           |
| **Trust**            | Your decision, recorded once per project, that Code Factory may run that project's setup and check commands, custom agent executables and agent steps. Nothing runs in an untrusted project.                                                              |
| **Tool permissions** | A separate, per-provider permission that lets writing steps run shell commands (for example your tests). It is off by default and can be revoked at any time. Reviewers stay read-only regardless.                                                        |
| **Check step**       | A step that runs a command in your project, for example a linter. It receives `CODE_FACTORY_BASE_REVISION` (the commit the run started from) and `CODE_FACTORY_CHANGED_FILES` (one path per line). A check that changes a file that is not ignored fails. |

## Where your data lives

| Location                                    | What it holds                                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.code-factory/` in the project             | The project configuration (`project.json`: name, default model, custom agent, setup command), loop drafts and published versions (`loops/`), and runs with their evidence (`runs/`). |
| `trust.json` in the user-level folder       | Which projects you trust and which tool permissions you granted. It lives outside every project on purpose, so a repository cannot trust itself.                                     |
| `connections.json` in the user-level folder | Which agents you connected for each project, so they connect again on the next start. It stores provider names (and a custom executable path), never credentials.                    |

The user-level folder is `$XDG_CONFIG_HOME/code-factory` if that variable is set to an absolute path, otherwise `~/.config/code-factory`. On Windows it is `%APPDATA%\code-factory`. Set `CODE_FACTORY_HOME` to an absolute path to use a different folder. Relative values of these variables are ignored. A folder inside the project is refused. The folder and files are readable only by you.

Code Factory's own `.code-factory/` data never counts as an uncommitted change and is never committed to your branch.

## The command line

Run Code Factory with `npx @thiagosbrito/code-factory start` from your repository, or `code-factory` if it is installed.

| Command                                                              | What it does                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code-factory start [--project directory] [--port 4310] [--no-open]` | Starts the local server and prints a link carrying a session token that changes on every start. It opens the link in your browser when the terminal is interactive. Press Ctrl+C to stop.                  |
| `code-factory init [directory]`                                      | Creates `.code-factory/project.json` in the directory (the `--project` value, or the current folder, when none is given). It never overwrites existing configuration. No agent, model or loop is selected. |
| `code-factory doctor`                                                | Prints, as JSON, which agent executables were found on your PATH. It does not launch them. Detection does not prove identity, sign-in or capabilities.                                                     |
| `code-factory --version` (or `-v`)                                   | Prints the installed version.                                                                                                                                                                              |
| `code-factory --help` (or `-h`)                                      | Prints the command summary. Running with no command does the same.                                                                                                                                         |

| Flag                    | What it does                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `--project <directory>` | The workspace to serve. Defaults to the current directory. To change workspace, restart with a different value.                               |
| `--port <number>`       | The port to listen on, 0 to 65535. The default is 4310. `0` picks a free port. If the port is busy you are told to choose another or use `0`. |
| `--no-open`             | Do not open the browser automatically.                                                                                                        |

Code Factory needs Node 22.12 or newer and refuses to start on an older version. Open the printed link rather than typing the address: the API refuses requests without the session.

## Quick start (about 10 minutes)

You need Node 22.12 or newer, a Git repository with at least one commit and a clean working tree, and one of Codex, Kiro or Claude Code installed and signed in.

1. **Start it.** In your repository, run `npx @thiagosbrito/code-factory start`. Open the printed link if it does not open on its own.
2. **Go to Setup.** On first use the app shows **Connect your first project**. Enter a **Project name**.
3. **Choose an agent.** In **Coding agent**, select a card whose status reads **Executable detected**. It connects by itself after half a second. Wait for the status to change to **Connected**. If it does not connect, press **Verify connection**.
4. **Pick a default model (optional).** In **Default model**, leave **Agent default** or choose a model, and optionally move the effort slider.
5. **Finish.** Press **Finish setup**. If you do not want to configure anything yet, you can finish without an agent.
6. **Trust the project.** The first time you execute a run, Code Factory asks whether to trust the project and lists every command the project would run. Trust it only if you wrote or reviewed it.
7. **Create a loop.** Open Loops, create a loop, add steps, and publish it. Publishing checks that the steps' outputs and agent bindings are valid.
8. **Create a run.** Start a new run from the published loop with a task description. Check the run branch name suggested in the dialog. Your working tree must be clean.
9. **Execute it.** Open the run and press **Execute run**. The first time, Code Factory may ask whether to allow the agent to run shell commands. Declining is safe: steps then run with file tools only.
10. **Review.** Read the evidence and the commits on the run branch. When the run is finished, **Back to <branch>** returns your checkout to the branch you started from. The run branch and its commits are always kept, and nothing is pushed.

## Safety rules to remember

- Only one run can hold a project at a time. Cancel a pending run (**Cancel run**) to free it.
- A run does not start if the working tree has uncommitted changes, or a merge, rebase, cherry-pick, revert or bisect is in progress. Code Factory never stashes, resets or cleans your files.
- If you switch branches while a run is pending or active, its next step is refused with a message naming the branch to switch back to.
- A restart never resumes anything on its own. An unfinished run shows **Resume run**.
- Reviewer steps are read-only. If a reviewer or check changes a file that is not ignored, the step fails and the evidence lists what changed.
