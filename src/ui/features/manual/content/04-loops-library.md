# The Loops library

The Loops screen opens on the **Loops library**, with the subtitle "Saved drafts and immutable published versions for future runs." From here you create a draft, start from a template, import a loop document, export a loop to a file, and open a draft in the editor. This chapter covers everything you can do before the editor opens. The editor itself, and the native file translation that lives inside it, are described at the end of the chapter.

The library only lists loops that belong to the current project. It shows **Loading loops…** while it fetches them. If the project's loop storage cannot be read, a red message appears under the header and stays until the next successful load.

## The header

| Control                  | What it does                                                                                                                      | What changes                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Use starter template** | Shows or hides the starter picker. Clicking it again hides the picker.                                                            | Nothing is saved.                                             |
| **Import JSON**          | Closes the starter picker, clears any text in the import panel, opens the **Import canonical loop JSON** panel and scrolls to it. | Nothing is saved.                                             |
| **Create empty loop**    | Saves a new draft named "Untitled loop" with no steps and opens it in the editor.                                                 | A new loop appears in the project, with a draft at version 1. |

## The empty state

A project with no loops shows a dashed card titled **No user loops yet**. It reads "Create an empty draft, choose a starter, or import a canonical loop document." Its **Create empty loop** button does the same as the one in the header. The three header actions work in the empty state too.

## Starting from a template

**Use starter template** opens a grid titled "Starter templates" with two cards. Each card has a **Create draft** button.

| Starter                                  | What it contains                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Implement → Review → Validate**        | "A small three-step loop for focused changes." Three agent steps in a line: Implement (implementation stage, role Implementer), Review (review stage, role Reviewer) and Validate (validation stage, role Validator). Each step depends on the one before it. No groups, joins or decisions. Policy: at most 3 attempts per step and 2 implementation rounds. |
| **Gated implementation and six reviews** | Evidence, planning, implementation, gates on the changed files, six read-only reviews and a final adjudication with one repair round. See the breakdown below.                                                                                                                                                                                                |

The gated starter has these parts:

- **Evidence.** One step, **Requirements and baseline**, then two parallel steps, **Domain and API evidence** and **UI and test evidence**. The two parallel steps form a group named "Parallel evidence".
- **Planning.** **Design and plan** waits for both evidence steps, using an "all" join.
- **Implementation round.** A repeating group named "Implementation and three review pairs" runs at most 2 iterations. It contains **Implement or repair**, **Stage candidate**, three check steps (**Lint changed files**, **Type-check changed files**, **Coverage of changed files (90%)**, with the default threshold; the `CODE_FACTORY_COVERAGE_THRESHOLD` environment variable overrides it), and **Verify candidate diff**, which runs `git diff --check HEAD`. The check steps run commands; they are not agent steps.
- **Six reviews.** After the diff check, these read-only agent steps run: **Code quality review**, **React and accessibility review**, **Performance review**, **Security review**, **Business acceptance review** and **Test quality review**. Their instructions tell the reviewer it cannot run commands and must judge the code and the check receipts.
- **Adjudication.** **Verify and adjudicate** joins all six reviews. A `pass` outcome moves on to the final step. A `repair` outcome sends the run back to **Implement or repair**. The group exits on `pass`, and a second repair decision rejects the run with its evidence kept.
- **Closing.** **Final verification** records the final validation and handoff receipts.

| Control                              | What it does                                                                          | What changes                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create draft** (on a starter card) | Saves a draft built from that starter under a new loop ID and opens it in the editor. | A new loop with a version 1 draft. On success the picker closes. If saving fails, the picker stays open and the error appears under the header. |

Starter drafts are ordinary drafts. They carry no agent bindings of their own, so the steps use the project default or a binding you choose in the editor before publishing.

## Loop cards

Each loop in the library can show up to two cards: its current draft and its latest published version.

| Part of the card                | What it shows                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Status line                     | **Draft v*N*** for a draft, **Published v*N*** for a published version.                                                                    |
| Title                           | The loop name.                                                                                                                             |
| Summary                         | The number of steps. On a published card, if it has versions, it adds "Publications:" followed by every published version, such as v1, v2. |
| **Inspect published structure** | Published cards only. Expands to the step names and the counts of groups, joins and decisions.                                             |

| Control         | Where                   | What it does                                                                  | What changes                                                           |
| --------------- | ----------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Edit draft**  | Draft card              | Opens the draft in the editor.                                                | Nothing until you save in the editor.                                  |
| **Export JSON** | Draft or published card | Downloads the loop as a portable JSON file named `<loop id>-v<version>.json`. | A file is saved in your browser's downloads. The project is unchanged. |

A published card has no edit button. There is no duplicate or delete action in the library.

### Drafts, published versions and immutability

A loop has one draft and any number of published versions. Publishing happens in the editor, not in the library. When you publish, the draft is frozen as the next numbered version and that version file is never rewritten. The draft then moves on to the following version number, so the card list shows both **Draft v2** and **Published v1** after the first publish. To change a published loop, you edit the draft and publish it as a new version; the old version stays available to runs that already use it.

A draft can only be saved at the next free version number. The editor's publish step also checks that the loop has at least one step, that every step has non-empty expected outputs, and that every step has a project default or step binding pointing at an authenticated, verified agent with an available model. If any check fails, publishing is refused with a message naming the step.

Export includes only the loop's definition: schema version, name, steps, dependencies, groups, joins, decisions and policy. The ID, version and status are not written, so an exported published loop imports back as a new draft.

## Importing a loop document

**Import canonical loop JSON** is a collapsible panel under the header. It imports Code Factory's own portable loop format, the same file that **Export JSON** produces. It does not read Codex, Claude or other agent-native files; those are handled by native translation inside the editor.

The document must be an object with `format` set to `code-factory-loop`, `formatVersion` set to 1, and a `definition` holding the loop. Unknown keys are rejected.

| Control                                        | What it does                                                                                                | What changes                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Paste a portable loop document** (text area) | Holds the JSON. Editing the text clears any earlier preview and errors.                                     | Nothing is saved.                                                                     |
| **Validate import**                            | Parses and checks the text without saving.                                                                  | Shows either a list of errors or a preview.                                           |
| **Confirm import: _name_**                     | Appears only after a successful validation. Saves the previewed loop as a draft and opens it in the editor. | A new loop with a version 1 draft and a new ID. After a save, the preview is cleared. |

After a successful validation the panel says "Valid draft with _N_ steps. Confirm to save it in this project." The imported loop always receives a new ID, version 1 and the draft status, whatever the file said, so importing never overwrites an existing loop.

### Error lists

Validation problems appear as a red bulleted list (an alert) under the buttons. Each line starts with where the problem is: `JSON:` for text that is not valid JSON, the field path or `document:` for a wrong envelope, and `definition.` followed by the path for a loop that does not satisfy the loop rules. No draft is saved while any error is listed.

## Native translation

Native translation turns agent-native configuration files into a loop draft, or a draft into a native file. It lives in the editor, in a band called "Native configuration translation" below the editor header, so you must open a draft first. Use **Create empty loop** if you only want to import.

Translation never connects to or runs an agent. The formats offered are exactly the ones the factory lists, and any other native format is unsupported. In this version they are:

| Format                         | Folder and extension                   | Directions        |
| ------------------------------ | -------------------------------------- | ----------------- |
| **Cursor project rule (.mdc)** | `.cursor/rules/<name>.mdc`             | Import and export |
| **Kiro workflow**              | `.kiro/workflows/<name>.workflow.json` | Import only       |

There is no Codex or Claude native format in this version. For a format that is import-only, the **Direction** list disables **Export** and a note reads "Kiro workflow is import-only."

| Control                             | What it does                                                                                                                                                                                                               | What changes                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Native format**                   | Chooses the format. Switching to a format that cannot export while **Export** is selected returns the direction to **Import**.                                                                                             | Clears any preview. Reloads the suggested names.       |
| **Direction**                       | **Import** reads a native file into the draft. **Export** writes the draft to a native file.                                                                                                                               | Clears any preview.                                    |
| **Configuration name**              | The file name, without folder or extension. Suggestions come from the matching files already in the folder. It must start with a lowercase letter and use only lowercase letters, digits and hyphens, up to 64 characters. | Clears any preview. The loop ID is the starting value. |
| **Preview**                         | Runs the translation without writing anything.                                                                                                                                                                             | Shows the preview box described below.                 |
| **Apply import** / **Apply export** | Carries out the previewed change.                                                                                                                                                                                          | See below.                                             |

All of these are disabled while the editor is busy or a request is in progress.

### The preview

The preview box shows:

- **Affected path.** The file the change reads or writes, relative to the project.
- **Conflict.** A red line for each conflict. Apply is disabled while any conflict is listed.
- **Translation report.** One line for each issue, as "unsupported" or "lossy", then the field and a message. Unsupported means the source has something the target cannot hold. Lossy means it can be held only in part. Read these before you apply, because they list what will be lost or changed.
- **For an import,** a summary of the draft that would result. A single step shows its name. A larger result shows the step count, the group count and how many steps the importer generated, followed by **Imported steps**. Expand any step to read the instruction an agent would receive. Steps the importer added that have no native counterpart carry the tag **Generated by importer**.
- **For an export,** the full text of the file that would be written.

Apply stays disabled if you change the draft after previewing. If you try anyway, the message "Draft changed since preview. Preview again." appears.

### Importing a native file

An import needs a native file that exists at the affected path, otherwise it fails with a message saying the file was not found in the project. It also requires an empty draft: no steps, dependencies, groups, joins or decisions. Otherwise it fails with "Import requires an empty draft to preserve existing steps."

- A **Cursor project rule** becomes one agent step. The rule's description becomes the loop and step name, and the rule body becomes the instruction. The report lists every frontmatter field other than the description as unsupported, and always notes that rule activation is not portable loop scheduling. The rule needs frontmatter, a description and a non-empty body.
- A **Kiro workflow** is mapped to steps, groups and joins. The report lists whatever the mapper could not carry over, and the importer may add steps of its own, tagged as above.

**Apply import** replaces the draft in the editor with the result and shows "Imported into the draft. Save the draft to keep it." The native file is never changed, and nothing is stored until you use **Save draft**.

### Exporting a native file

Export is available only for a draft and only for formats that support it. A Cursor rule is built from the first step, which must be an agent step with instructions. Everything else is reported as lossy: the loop ID, the version, any extra steps, dependencies, groups, joins, decisions, a non-default policy, and the first step's role, binding, expected outputs, stage, group and position. The exported rule is written with `alwaysApply: false`, so it needs explicit activation in Cursor.

**Apply export** creates the file in the project and shows "Exported _path_."

### What is never overwritten

Export only ever creates a new file. If a file already exists at the target path, the preview shows "An existing rule would be overwritten; choose another name." and Apply is disabled. Choose a different **Configuration name**. If the file appears between preview and apply, or if the draft or the file changed, the write is refused and you are asked to preview again. The folder is not allowed to contain links in its path, and a native file must be a regular text file under 1 MB. Import never writes to any native file, and neither direction changes your other agent folders or instruction files.

## The Board and Graph views

The **Board | Graph** switch, labelled "Editor view", is part of the editor header and is not on the library. **Board** is the default, and the editor remembers your last choice in your browser. The library cards do not depend on it. Returning to the library with **← Loops** reloads the list and puts focus back on **Create empty loop**.
