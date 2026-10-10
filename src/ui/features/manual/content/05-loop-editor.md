# The loop editor

The loop editor is where you build a loop: the steps, the order they run in, who runs them and what happens after a decision. You open it from the loops library by creating a loop or opening an existing one. You always edit a **draft**. Nothing you change here touches a run that already exists, and nothing becomes available for new runs until you publish.

This chapter walks through the screen from top to bottom: the header, the left panel, the two views of the same draft (**Board** and **Graph**), the step drawer, and then what each setting means when a run executes.

## How the editor is laid out

| Area                             | What it holds                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| Header                           | Back button, loop title, draft number, view switch, Undo, Redo, **Save draft** and **Publish**. |
| Message line                     | One line below the header that reports errors, refusals and confirmations.                      |
| Native configuration translation | A panel for importing and exporting agent-native files. It is not covered in this chapter.      |
| Left panel                       | Step types (the add buttons) and the Groups tools. It stays on screen in both views.            |
| Main area                        | Either the **Board** or the **Graph**. Both edit the same draft.                                |
| Step drawer                      | A panel that slides in from the right when you open a step.                                     |

While a save or publish is in progress the whole editor is locked, and the controls come back when it finishes.

## The header

| Control                            | What it does                                                             | What changes                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **← Loops**                        | Returns to the loops library.                                            | Locked while a save or publish is running.                                                                                         |
| **Loop title**                     | The name of the loop.                                                    | Edits apply to the draft at once and can be undone. A published loop needs a non-empty title.                                      |
| **Draft v1** (the number varies)   | Shows which version you are editing.                                     | Read only. After you publish, it moves to the next number.                                                                         |
| **Board** / **Graph**              | The view switch, labeled **Editor view**. The active one is highlighted. | Only changes how the draft is drawn. Your choice is remembered in this browser and never alters the loop.                          |
| **Undo** / **Redo**                | Steps back or forward through your edits.                                | Disabled when there is nothing to undo or redo. The shortcuts are Ctrl+Z (Cmd+Z on a Mac) and Shift with the same keys for redo.   |
| **Save draft**                     | Stores the draft in the project.                                         | Enabled only when the draft has unsaved changes. The message line then says "Draft saved to the project." Saving does not publish. |
| **Publish v1** (the number varies) | Validates the draft, saves it and publishes it as an immutable version.  | See the next section.                                                                                                              |

The message line shows refusals from any edit, for example a connection that would create a cycle. A refused edit changes nothing and adds nothing to the undo history.

### Saving and publishing

Save and publish do different jobs.

- **Save draft** keeps your work in progress. There is no automatic save, so save before you leave if the button is enabled.
- **Publish** freezes what you have as version N. Runs are created from published versions only. After a successful publish the message line says "Published immutable version N. Future edits target draft vN+1." and the editor continues on the next draft number with a clean undo history.

A published version never changes. If you need a different loop, edit the new draft and publish it as the next version. Runs that already started keep the version they started from.

Publish checks the draft first. If anything is wrong, nothing is saved or published, and the message line lists the problems. These block publishing:

| Problem                                                                                                                                                                                          | Where to fix it                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| The loop has no steps ("A published loop needs a step.").                                                                                                                                        | Add a step.                                                                                |
| The loop has no title.                                                                                                                                                                           | **Loop title**.                                                                            |
| A step has no title, no role or no instructions.                                                                                                                                                 | **Title**, **Role** and **Instructions** in the drawer.                                    |
| A step has no expected outputs, or one line of its expected outputs is empty.                                                                                                                    | **Expected outputs (one per line)**. A trailing blank line counts as an empty output.      |
| A step has no agent: it has no binding of its own and the project has no default agent.                                                                                                          | **Coding agent** in the drawer, or set a project default in setup.                         |
| A step's agent is not connected, or its model or effort is not in the agent's current catalog.                                                                                                   | **Coding agent**, **Model** and **Effort** in the drawer, or reconnect the agent in setup. |
| Any structural rule is broken (a cycle, a join that does not match its incoming connections, a decision whose branches do not match its outgoing connections, a repeat group that is not valid). | The step, join, decision or group the message names.                                       |

Two details are easy to miss. Every step needs a usable agent to publish, including check steps, even though a check step never calls an agent (see "What a check step runs"). And the server repeats the agent checks when you publish, so a step can still be refused if the agent connection changed after you opened the editor.

## Adding steps

The left panel is titled **Step types**.

| Control                                                                               | What it does                                                                                                                                                    | What changes                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **+ Agent step**                                                                      | Adds a step named "New agent step" in the Implementation stage, with role "Agent", the instruction "Describe this step." and the expected output "Step result". | An unconnected step. It has no dependencies until you connect it.           |
| **+ Check step**                                                                      | Adds a step named "New check" in the Validate stage, with role "Check", the instruction "Describe this step." and the expected output "Step result".            | Replace the instruction with a shell command, see "What a check step runs". |
| **+ Add step** (at the bottom of each Board column, or at the top of each Graph lane) | Adds a step to that stage. The Validate stage gets a check step. Every other stage gets an agent step.                                                          | Same defaults as above, with the stage set.                                 |

New steps are not connected to anything. Use the connection tools described below to place them in the order you want. Open the step in the drawer to rename it and write its instructions.

There are exactly two step kinds: agent steps and check steps. A check step can only live in the Validate stage. There is no control to change a step's kind after it is created.

## The five stages

Both views organize steps into five stages. The stage is a property of the step. Besides organizing the screen, it changes how a run treats the step.

| Stage                 | Description shown in the editor                  | Effect at run time                                                                                                                                                                          |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Evidence**       | Requirements, discovery, and baseline context    | An ordinary writing step.                                                                                                                                                                   |
| **2. Plan**           | Design decisions and implementation planning     | An ordinary writing step.                                                                                                                                                                   |
| **3. Implementation** | Source changes and candidate preparation         | An ordinary writing step.                                                                                                                                                                   |
| **4. Review**         | Quality, accessibility, security, and acceptance | The step is a reviewer: it only reads the workspace, and several ready reviews may run at the same time. It answers with one verdict on the first line: pass, changes-requested or blocked. |
| **5. Validate**       | Executable checks and final outcome              | Check steps live here. Validate steps, like Review steps, also receive the results of every upstream step that succeeded on the same candidate, not only their direct dependencies.         |

Outside the Review stage, the factory runs one step at a time, even if several are ready.

## The Board view

The Board is the default view. It is titled **Execution stages**, with a **Draft v** badge. A reminder under the title says to drop only on labeled Before / After targets, and that coordinates never change dependencies. The five stages are columns, and each column lists the steps in that stage.

### A step card

| Part of the card                    | What it shows                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Step name (a button)                | Opens the step drawer.                                                                                            |
| Second line                         | The step kind (agent or check), then either the group, written as the group kind and name, or the word ungrouped. |
| **Agent:**, **Model:**, **Effort:** | Who runs the step (agent steps only). See the next table.                                                         |
| Repeat line                         | For a member of a repeat group: "Up to N iterations · exit on X · continue on Y".                                 |
| **After:**                          | The names of the steps this step depends on.                                                                      |
| **Join all** or **Join any**        | Shown on a join step, with the number of sources.                                                                 |
| **Decision:**                       | Shown on a decision step, as a list of outcome and target pairs.                                                  |
| **before** / **after** buttons      | Move targets, see "Reordering on the Board".                                                                      |
| **Move** radio button               | Selects the step as the one to move.                                                                              |

### The Agent, Model and Effort lines

These lines describe the agent that will run the step, using the step's own binding if it has one and the project default if it does not.

| Line        | What it shows                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent:**  | The agent's name, for example Codex or Claude Code. Reads **Not configured** if the step has no binding and the project has no default. |
| **Model:**  | The model's display name, or its id if the agent does not list it. Reads **Agent default** when the step leaves the model to the agent. |
| **Effort:** | The effort level, or **Default**. A small meter of segments fills up to the level, one segment per level the agent offers.              |

If the step takes its values from the project default, hovering over the lines shows the tooltip "Inherited from the project default". This is the only inherited marker on a card. Check steps show none of these lines, because a check step runs a shell command and never an agent.

### Reordering on the Board

The Board changes execution order through explicit moves, never by where a card sits.

1. On the card you want to move, select its **Move** radio button. (You can also drag the radio button itself onto a target.)
2. On another card, click **before** or **after**.

The moved step is spliced into the chain. It leaves its old place and the steps around the gap are joined up, then it is connected before or after the target. It also takes the stage of the target step. The Board makes this change without a confirmation panel.

The Board refuses the move, with a message on the message line, when:

- You click **before** or **after** with no step selected ("Select a step to move using its Move radio button.").
- The moved or target step belongs to a group, join or decision ("This drop crosses a group, join, or decision. Edit its explicit connections instead.").
- The moved step has more than one incoming or outgoing connection ("Reordering a branch needs explicit connection editing."), or the target has several connections that make the position ambiguous.
- A check step would end up outside the Validate stage ("Check steps belong in Validate.").

For those cases use the step drawer (join and decision sections) or the Graph's connection tools.

## The Graph view

Choose **Graph** to see the same draft as a canvas. The Graph loads on demand. While it loads you see "Loading graph view…". If loading fails you see "The graph view could not be loaded. Your draft is unchanged." with **Retry** and **Use the Board** buttons.

The canvas has:

- Five **lanes**, left to right, one per stage, each titled like the Board's columns with a **+ Add step** button in its header (the button is named "Add step to" followed by the lane title for screen readers).
- **Step cards** showing the name, the role and kind, the Agent, Model and Effort lines (agent steps only), and small badges.
- **Dependency edges**, curved arrows from a step to the step that runs after it.
- Zoom controls in a corner. The Graph opens fitted to the whole loop, but never smaller than a readable zoom; a very large loop opens at its top left.

### What the badges and drawings mean

| You see                                                                                            | It means                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A badge such as `parallel: Name` or `repeat: Name`                                                 | The step is in that group.                                                                                                                                |
| A badge `waits for all` or `waits for any`                                                         | The step is a join with that mode.                                                                                                                        |
| A badge `decision: pass / repair`                                                                  | The step is a decision with those outcomes.                                                                                                               |
| A stage chip                                                                                       | The stage of the step. It is hidden when the card has three or more badges, because the lane already names the stage.                                     |
| An outcome label on an edge                                                                        | That connection is followed when the decision returns that outcome.                                                                                       |
| A differently colored edge                                                                         | The connection feeds a join.                                                                                                                              |
| A frame labeled "Parallel group: Name" (dashed) or "Repeat group: Name (max N iterations)" (solid) | A group region drawn around its members. There is one frame per lane that holds members, and only the first carries the label. Frames cannot be selected. |
| A back arrow labeled `outcome (repeat)`                                                            | A repeat group's continuation: the arrow from the exit decision back to the start of the group. It is not a dependency. It cannot be selected or deleted. |

### Connecting and disconnecting with the mouse

| Gesture                                                       | What it does                                                | What changes                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Drag from a step's right handle to another step's left handle | Creates a dependency: the second step runs after the first. | If the target is a join, it gains the new source. Connecting twice is a no-op.    |
| Click a connection, then press Delete or Backspace            | Removes the connection.                                     | May ask for confirmation (see "Confirmation panel").                              |
| Click a connection, then its **×** button                     | Same as Delete.                                             | The button is named "Delete:" followed by a description of the dependency.        |
| Click a step                                                  | Opens the step drawer.                                      | See "The step drawer".                                                            |
| Drag a step to a new place                                    | Moves the step. The position is saved.                      | If you drop it into a different lane its stage changes. May ask for confirmation. |
| Drag a box around several steps, then drag                    | Moves them together.                                        | Same as above.                                                                    |

Dragging a step to a new position inside its lane is presentation only: it never changes who depends on whom. Positions are stored for all steps at once, so the Graph never leaves a loop half positioned.

A connection can be refused. The usual reasons are a cycle, a connection that already exists, a source that is a decision (see below), a link between two members of a parallel group, or a result that would break a join. The reason appears on the message line and the loop is left alone.

A decision step cannot start a plain connection: its right handle is disabled, with the tooltip explaining it. A decision's outgoing connections come from its named branches, which you edit in the step drawer.

### Connecting and disconnecting without a mouse

Below the help text there is a row labeled **Step connections**. It shows "Selected: " and the step name once one step is selected, or the hint "Focus a step and press Space to select it, then use these buttons". It has two buttons, both disabled until exactly one step is selected.

| Control                      | What it does                                                                                                             | What changes                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connect to…**              | Opens a dialog titled "Connect (step name) to…" listing every other step.                                                | Choosing one creates the dependency, announces it and closes. A step that cannot be chosen stays in the list with its reason, for example **Already connected**. |
| **Disconnect…**              | Opens a dialog titled "Disconnect (step name)" with two lists, **Runs after (incoming)** and **Runs before (outgoing)**. | Each entry reads "Remove A → B". A removal that is refused shows its reason. A list with none shows **None**.                                                    |
| **Close** (in either dialog) | Closes the dialog.                                                                                                       | Nothing changes.                                                                                                                                                 |

Refusals inside these dialogs are written in red at the bottom of the dialog so that a screen reader reads them there.

### Keyboard use in the Graph

Keys work when a step card has focus. They do nothing while you type in a field or press a button.

| Key                                          | What it does                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Tab                                          | Moves focus to a step.                                                                               |
| Space                                        | Selects the focused step.                                                                            |
| Enter                                        | Opens the step drawer.                                                                               |
| C                                            | Opens **Connect to…** for the step.                                                                  |
| D                                            | Opens **Disconnect…** for the step.                                                                  |
| Arrow keys on a selected step                | Move it 10 pixels. Hold Shift for 40. Consecutive arrow presses form one undo step.                  |
| Alt with an arrow key                        | Moves focus to the nearest step in that direction. If there is none it announces "No step that way". |
| Delete or Backspace on a selected connection | Removes it.                                                                                          |

Moves announce what happened in a live region: for example that a step moved, reached the lane edge ("is at the lane edge") or cannot move further. Arrow keys never move a step across a lane boundary by accident: they stop at the edge.

### Confirmation panel

Some changes are allowed but have side effects. For those, the Graph shows a dialog titled **Apply this change?** with the explanation "This change is allowed, but it also does the following." and a list of consequences. It has two buttons.

| Control          | What it does                                                                          | What changes                                        |
| ---------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Cancel**       | Dismisses the dialog. This is the first control and gets focus. Escape does the same. | Nothing. A dragged step snaps back.                 |
| **Apply change** | Applies the change as a single undo step.                                             | The change and the listed consequences take effect. |

You are asked in these cases:

- **Removing a connection that leaves a join with fewer than two sources.** The join is removed. If the join was "any", connecting the steps again gives an ordinary fan-in that waits for all.
- **Removing a connection that carries several decision outcomes** (several outcomes sharing one target). All those outcomes are removed.
- **Moving a step into the Review lane.** It becomes a reviewer: it only reads the workspace, may run alongside other reviews, and a changes-requested verdict ends the run as rejected unless a repeat group continues on that outcome.
- **Moving a step out of the Review lane.** It may write to the workspace, runs on its own, and changes-requested no longer rejects the run.
- **Moving a step into or out of the Validate or Review lanes when it has ancestors beyond its direct dependencies.** The panel warns that it will start or stop receiving the results of every upstream step.

A change the draft would refuse outright has no confirmation panel. You get the refusal message instead.

Moving a step to another lane is also refused for a step that belongs to a group, join or decision ("This step belongs to a group, join, or decision. Edit its explicit connections instead."), and a check step cannot leave the Validate lane. A step in a group, join or decision can still be rearranged inside its own lane.

Groups, joins and decisions are shown in the Graph. The Graph's own help text says to edit them in the Board view. The Groups tools in the left panel and the drawer's join and decision sections are also available while the Graph is shown.

## The Groups panel

The **Groups** section of the left panel creates and removes groups. A step can belong to only one group.

### Parallel group

A parallel group says that its members are not ordered relative to each other. Use it for steps, such as several reviews, that need the same inputs.

| Control                   | What it does                                                                   | What changes                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Group name**            | The group's name.                                                              | If left empty the name is "Parallel group" (or "Repeat group").                                                                   |
| One checkbox per step     | Chooses the members.                                                           | Selections that no longer match an existing step are dropped.                                                                     |
| **Create parallel group** | Creates the group from the checked steps (two or more, none in another group). | Dependencies between members are removed, because a parallel group cannot order its own members. Each member remembers its group. |

At run time a parallel group does not by itself make steps run at the same moment. All it guarantees is that no order is imposed between its members. The factory runs one writing step at a time. Several ready steps in the Review stage can run together.

### Repeat group

A repeat group lets a decision send the run back to the start of a stretch of steps, a limited number of times. Fill in every field, then create it.

| Control                                                       | What it does                                                                                        | What changes                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Repeat limit**                                              | The maximum number of rounds, 1 to 10.                                                              | Stored on the group. At run time the loop's own policy also caps the rounds (see "Repeating and retrying"). |
| **Repeat decision step** (placeholder **Exit decision step**) | The step that decides whether to repeat or leave. It must be one of the checked members.            | This step becomes a decision.                                                                               |
| **Exit outcome**                                              | The outcome that leaves the group. Starts as `pass`.                                                | One branch of the decision.                                                                                 |
| **Exit target**                                               | The step that runs after the group when the exit outcome is returned. It must be outside the group. | A dependency from the decision step to this step is created.                                                |
| **Continue outcome**                                          | The outcome that repeats. Starts as `repair`. It must differ from the exit outcome.                 | The second branch of the decision.                                                                          |
| **Continuation target** (placeholder **Continuation target**) | The step the repeat goes back to. It must be inside the group.                                      | Drawn as the back arrow in the Graph. It is not a dependency.                                               |
| **Create repeat group**                                       | Creates the group from the checked steps and these settings.                                        | Any decision the exit step already had is replaced by these two branches.                                   |

### Existing groups

Each group is listed under **Groups** as its name and kind.

| Control                    | What it does                                                                                    | What changes                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Add selected step here** | Adds the step selected with a **Move** radio button (or dragged onto the button) to this group. | The step must have no group. For a parallel group, connections between it and the members are removed. If nothing is selected the message line says to select a step first. |
| **Remove**                 | Deletes the group.                                                                              | Its members become ungrouped. Removing a repeat group also removes its exit decision.                                                                                       |

## The step drawer

Click a step name on the Board, click a step in the Graph, or press Enter on a focused Graph step to open the drawer. It is titled **Step configuration**, shows the step's name and its stage with "Draft only", and states that changes affect future versions only. Close it with **×**, **Done** or Escape.

Changes in the Title, Role, Instructions, Expected outputs and agent fields apply as you type and can be undone. The join and decision sections instead keep a local draft until you press their buttons. Errors from the drawer appear in an alert at the top of the drawer.

| Control                             | What it does                                                           | What changes                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Title**                           | The step's name.                                                       | Shown on cards, in the Graph and in runs. Required to publish.                                                                          |
| **Role**                            | A short label for what the step is, such as "Reviewer".                | Shown on the Graph card and in the run inspector. It is not sent to the agent. Required to publish.                                     |
| **Instructions**                    | The text the agent is told to do. For a check step, the shell command. | See "What an agent step receives" and "What a check step runs". Required to publish.                                                    |
| **Expected outputs (one per line)** | What the step should produce, one item per line.                       | Required to publish, and no line may be empty. Shown in the run inspector as "Expected outputs". It is not added to the agent's prompt. |
| **Coding agent**                    | Which agent runs the step.                                             | See "Choosing the agent".                                                                                                               |
| **Model**                           | Which model the agent uses.                                            | See "Choosing the agent".                                                                                                               |
| **Effort**                          | How much effort the agent puts in.                                     | See "Choosing the agent".                                                                                                               |
| **Join** section                    | Makes the step wait for several earlier steps.                         | See "Joins".                                                                                                                            |
| **Decision branches** section       | Makes the step choose between named outcomes.                          | See "Decisions".                                                                                                                        |
| **Nudge visual right**              | Moves the step 20 pixels to the right on the canvas.                   | Presentation only. Refused with a message when the step is already at the right edge of its lane.                                       |
| **Delete step**                     | Removes the step.                                                      | See "Deleting a step".                                                                                                                  |
| **Done**                            | Closes the drawer.                                                     | Nothing else; edits are already applied.                                                                                                |

### Choosing the agent

The agent section is the same control for every step.

**Coding agent** is a dropdown. The first option, **Inherit project default**, is followed by the project default agent's name, or "not configured" if the project has none. The other options are the agents Code Factory knows about, except the mock agent, which is only for tests.

- While the step inherits, the **Model** and **Effort** controls show the project default's values.
- If you change the model or effort of an inheriting step, the step gets its own binding, copied from the default with your change, and no longer follows the project default. A note under the controls says so.
- To go back, choose **Inherit project default** again.
- Choosing a specific agent starts that agent at **Agent default** with no effort set.

**Model** is a dropdown that lists **Agent default** (let the agent decide), then each model the connected agent lists. If the agent accepts any model name, there is also a **Custom model…** option, which shows a text box (labeled "Step model id") with the placeholder "Model id or alias, e.g. claude-opus-5-5". Until you type something, the agent default is used. If a saved model is no longer listed, it shows as "(unavailable)". The control is disabled until the agent is connected.

**Effort** is a slider. The leftmost stop is the agent default (no effort set). The stops after it are the levels the selected model offers, from lightest to heaviest. The current level is written above the slider. If the model offers no effort levels, or the agent is not connected, the slider is disabled and says **Not offered**. If you change the model and the new model still offers your effort level, it is kept. Otherwise effort goes back to the default. A saved level that the agent no longer lists stays as a last stop marked "(unavailable)", so it is never dropped silently.

If the chosen binding cannot be used, a red message appears under the controls, for example that the agent is unavailable until its connection is verified, that the model is unavailable in the current catalog, or that the effort is unavailable for this model. The same problem blocks publishing.

### Joins

A join makes a step wait for two or more earlier steps.

| Control                 | What it does                                                           | What changes                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Checkbox per other step | Chooses the sources.                                                   | Kept in the drawer until you press **Set join**.                                                                                     |
| **Join mode**           | **All** or **Any**.                                                    | Kept until you press **Set join**.                                                                                                   |
| **Set join**            | Applies the sources and mode. It needs at least two different sources. | The step's incoming connections are replaced by exactly the sources you checked. Incoming connections you did not check are removed. |
| **Remove join**         | Appears once a join exists.                                            | The join record is removed; the connections stay and the step becomes an ordinary step that waits for all of them.                   |

At run time, **All** starts the step when every source that is still on an active path has succeeded. Sources skipped because a decision did not pick their branch do not hold it back. **Any** starts the step as soon as one active source has succeeded.

### Decisions

A decision lets a step choose where the run goes next. Its outcomes are names you invent, with a target step for each.

| Control                                      | What it does                                                                                                                   | What changes                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **First outcome** / **First target**         | The first branch: an outcome name and the step it leads to. A new decision starts with `pass` and `repair`.                    | Kept in the drawer until you press **Set decision**.                                                                  |
| **Second outcome** / **Second target**       | The second branch.                                                                                                             | Same.                                                                                                                 |
| **Outcome 3**, **Target 3**, and so on       | Extra branches.                                                                                                                | Same.                                                                                                                 |
| **Add branch**                               | Adds an empty extra branch.                                                                                                    |                                                                                                                       |
| **×** (named "Remove branch" and its number) | Removes an extra branch. The first two cannot be removed.                                                                      |                                                                                                                       |
| **Set decision**                             | Applies the branches. It needs at least two branches, each with a name and a target, and every outcome name must be different. | The step's outgoing connections are replaced by one connection per branch.                                            |
| **Remove decision**                          | Appears once a decision exists.                                                                                                | The decision is removed. It is refused if the step is the exit step of a repeat group; remove the repeat group first. |

Targets can be any other step. Because a decision owns its outgoing connections, you add or change branches here rather than drawing plain connections from it.

At run time the decision step's agent is told "Return exactly one outcome:" followed by the outcome names, and the factory reads the first line of its answer as the outcome. Formatting such as bold, quotes or a leading "Verdict:" is ignored, and the comparison is case-insensitive, so name your outcomes in lower case. An answer that does not name a declared outcome is rejected. Steps on branches that were not chosen are skipped.

Review-stage steps without a decision of their own are told to put one verdict on the first line: pass, changes-requested or blocked.

### Deleting a step

**Delete step** removes the step and closes the drawer. If the step had exactly one incoming and one outgoing connection, those two are joined together so the chain stays intact. The delete is refused, with a message in the drawer, if:

- The step is a member of a group ("Remove the group before deleting a member.").
- The step is part of a join or decision, or has more than one incoming or outgoing connection ("Remove joins and decisions that reference this step first.").

The delete can be undone with **Undo**.

## What each setting means at run time

When someone starts a run from a published version, Code Factory takes a snapshot of that version and resolves each step's agent once: the step's own binding if it has one, otherwise the project default at that moment. After that, editing the draft, the project default or a published loop does not change the run.

| Field or structure                      | At run time                                                                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title** and **Role**                  | Labels in the run views. The role is shown in the run's graph and inspector.                                                                                                       |
| **Instructions** (agent step)           | The first part of what the agent is sent. The factory then adds the task, the results of the steps it depends on, notes about changed files, and any required outcome line.        |
| **Instructions** (check step)           | The shell command to run.                                                                                                                                                          |
| **Expected outputs**                    | Shown in the run inspector as what the step declared. Not added to the agent's prompt.                                                                                             |
| **Coding agent**, **Model**, **Effort** | The agent, model and effort used for that step's attempts. Starting a run is refused if the agent is not verified and authenticated, or the model or effort is not in its catalog. |
| Connections between steps               | The only thing that decides order. A step becomes ready when its sources have succeeded. Canvas positions never matter.                                                            |
| Stage                                   | See the stages table. Review steps are read only reviewers. Review and Validate steps receive more upstream results.                                                               |
| Join                                    | **All** or **Any** readiness, as described above.                                                                                                                                  |
| Decision                                | Chooses the branch that runs next. The rest are skipped.                                                                                                                           |
| Parallel group                          | No order between members.                                                                                                                                                          |
| Repeat group                            | Allows going back a limited number of times.                                                                                                                                       |

### What an agent step receives

The agent gets your **Instructions**, then the task description and ticket, the direct results of the steps it depends on, a note of the files changed so far in the run, and for decisions or reviews the line that asks for the outcome. Review and Validate steps also get the results of every upstream step that succeeded on the same candidate. Writing steps outside the Review stage have their changes committed to the run branch when they succeed.

### What a check step runs

A check step runs its **Instructions** as a shell command in the run's working copy. The command passes when it exits with code 0, and fails otherwise. Its output is recorded as evidence, and only the last 8,192 characters are kept. A check times out after five minutes. A check must not change files: if it does, the check is marked failed and its result is stale. For runs on the project itself, the command can read two environment variables, `CODE_FACTORY_BASE_REVISION` and `CODE_FACTORY_CHANGED_FILES` (one path per line). A check step has no separate command field. Its **Instructions** box is the command.

### Repeating and retrying

When the repeat group's decision returns the **Continue outcome**, the run goes back: the group's steps are reset, the round number goes up by one and the continuation target receives the decision's output as input. When the round limit is reached the run ends as rejected instead of going back.

The limit is the smaller of the group's **Repeat limit** and the loop's `maxImplementationRounds` policy, which counts the first implementation as round one. The editor has no control for that policy. A new loop uses the default of 2 rounds, so a **Repeat limit** above 2 has no extra effect unless the loop was created with a higher policy, for example by a starter or an import.

A review that returns changes-requested ends the run as rejected unless a repeat group continues on that outcome. A review that returns blocked puts the run in the blocked state.

Retries are a run-time action, not a loop setting. A step that failed in a failed run can be retried from the run page, up to the policy's `maxAttemptsPerStep`, which is 3 by default and also not editable here. A retry reopens the failed step and resets the steps that depend on it.

## Quick reference

| I want to…                           | Do this                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Rename the loop                      | **Loop title** in the header.                                                                            |
| Add an agent step                    | **+ Agent step**, or **+ Add step** in a stage.                                                          |
| Add a check                          | **+ Check step**, or **+ Add step** in the Validate stage.                                               |
| Write what a step does               | Open it, then **Instructions**.                                                                          |
| Pick the agent for one step          | Open it, then **Coding agent**, **Model**, **Effort**.                                                   |
| Make a step follow the project agent | **Coding agent**, then **Inherit project default**.                                                      |
| Put step B after step A              | Graph: drag A's right handle to B's left handle, or **Connect to…**. Board: Move A, then **after** on B. |
| Wait for several steps               | Open the step, then **Join**.                                                                            |
| Let a step choose a path             | Open the step, then **Decision branches**.                                                               |
| Send the run back to retry           | **Create repeat group** in the Groups panel.                                                             |
| Undo a mistake                       | **Undo**, or Ctrl+Z (Cmd+Z).                                                                             |
| Keep my work                         | **Save draft**.                                                                                          |
| Make the loop available for runs     | **Publish**.                                                                                             |
