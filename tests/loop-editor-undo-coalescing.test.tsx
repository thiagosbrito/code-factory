// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import {
  amend,
  commit,
  redo,
  undo,
  type History,
} from "../src/ui/features/loops/loop-editor-model.js";
import { useLoopEditorController } from "../src/ui/features/loops/useLoopEditorController.js";
import { chain } from "./support/loop-editor-builders.js";
import { project } from "./support/loops-ui.js";

afterEach(cleanup);

const named = (loop: LoopDefinition, name: string): LoopDefinition => parseLoop({ ...loop, name });
const rename = (name: string) => (current: LoopDefinition) => named(current, name);

describe("amend", () => {
  const start: History = { present: chain(), past: [], future: [] };

  it("returns the very same history when nothing changed", () => {
    expect(amend(start, start.present)).toBe(start);
  });

  it("replaces the present without adding an entry and drops the redo stack", () => {
    const entry = commit(start, named(chain(), "one"));
    const redoable = undo(entry);
    expect(amend(redoable, named(chain(), "two")).future).toEqual([]);
    const folded = amend(entry, named(chain(), "two"));
    expect(folded.past).toEqual(entry.past);
    expect(folded.present.name).toBe("two");
  });

  it("removes the entry when the change folds back to where the entry started", () => {
    const entry = commit(start, named(chain(), "one"));
    const back = amend(entry, start.present);
    expect(back.past).toEqual([]);
    expect(back.present).toEqual(start.present);
    expect(redo(undo(entry)).present.name).toBe("one");
  });
});

/** The controller's apply with the editor's history, as the Graph view drives it. */
const controller = () =>
  renderHook(() =>
    useLoopEditorController({
      initial: chain(),
      project,
      agents: [],
      onPublished: async () => undefined,
    }),
  );
const names = (hook: ReturnType<typeof controller>) => hook.result.current.history;
const press = (hook: ReturnType<typeof controller>, name: string, coalesce = "keys") =>
  act(() => void hook.result.current.apply(rename(name), { coalesce }));
const edit = (hook: ReturnType<typeof controller>, name: string) =>
  act(() => void hook.result.current.apply(rename(name)));
const pressUndo = (hook: ReturnType<typeof controller>) =>
  act(() => hook.result.current.setHistory(undo));

describe("undo coalescing in the editor controller", () => {
  it("folds a run of same-key applies into one entry", () => {
    const hook = controller();
    press(hook, "one");
    press(hook, "two");
    press(hook, "three");
    expect(names(hook).past).toHaveLength(1);
    pressUndo(hook);
    expect(names(hook).present).toEqual(chain());
    expect(names(hook).past).toEqual([]);
  });

  it("does not fold into an older entry after folding back removed the run's own", () => {
    const hook = controller();
    edit(hook, "A"); // X -> A, a plain edit
    press(hook, "B"); // the run starts: past = [X, A]
    press(hook, "A"); // folds back to A: the run's entry disappears
    expect(names(hook).past.map((loop) => loop.name)).toEqual([chain().name]);
    press(hook, "C"); // must start a NEW entry, not fold into X -> A
    expect(names(hook).past.map((loop) => loop.name)).toEqual([chain().name, "A"]);
    pressUndo(hook);
    expect(names(hook).present.name).toBe("A");
    pressUndo(hook);
    expect(names(hook).present).toEqual(chain());
  });

  it("leaves a draft that was folded back to its start clean", () => {
    const hook = controller();
    press(hook, "B");
    press(hook, chain().name);
    expect(names(hook).past).toEqual([]);
    expect(names(hook).present).toEqual(chain());
    expect(hook.result.current.dirty).toBe(false);
  });

  it("does not fold into an older entry after Undo during a run", () => {
    const hook = controller();
    edit(hook, "A");
    press(hook, "B");
    press(hook, "B2");
    pressUndo(hook); // back to A; the run's loop is no longer the present
    press(hook, "C");
    expect(names(hook).past.map((loop) => loop.name)).toEqual([chain().name, "A"]);
    pressUndo(hook);
    expect(names(hook).present.name).toBe("A");
  });

  it("keeps folding after Undo and Redo return to the run's own entry, but not after another edit or a different key", () => {
    const hook = controller();
    press(hook, "B");
    pressUndo(hook);
    act(() => hook.result.current.setHistory(redo));
    press(hook, "B2");
    expect(names(hook).past).toHaveLength(1);
    press(hook, "Z", "other keys");
    expect(names(hook).past).toHaveLength(2);
    edit(hook, "E");
    press(hook, "Z2", "other keys");
    expect(names(hook).past).toHaveLength(4);
  });

  it("keeps every plain apply as its own entry", () => {
    const hook = controller();
    edit(hook, "one");
    edit(hook, "two");
    edit(hook, "three");
    expect(names(hook).past).toHaveLength(3);
    edit(hook, "three");
    expect(names(hook).past).toHaveLength(3);
  });
});
