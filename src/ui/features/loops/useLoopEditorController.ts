import { useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import type { AgentConnection } from "../../../adapters/contract.js";
import { parseLoop, type LoopDefinition } from "../../../domain/loop.js";
import { bindingError } from "../../shared/connection";
import { amend, commit, redo, undo, type History } from "./loop-editor-model";
import { api, loopResponseSchema, type ProjectResponse } from "../../shared/project-api";

const describeError = (error: unknown): string => {
  if (error instanceof ZodError) return error.issues.map((issue) => issue.message).join("; ");
  return error instanceof Error ? error.message : String(error);
};

const publicationErrors = (
  loop: LoopDefinition,
  project: ProjectResponse,
  agents: AgentConnection[],
): string[] => {
  const errors: string[] = [];
  let parsed: LoopDefinition;
  try {
    parsed = parseLoop({ ...loop, status: "published" });
  } catch (cause) {
    return [describeError(cause)];
  }
  if (!parsed.steps.length) errors.push("Add at least one step.");
  for (const step of parsed.steps) {
    if (!step.name.trim()) errors.push(`${step.id} needs a title.`);
    if (!step.instruction.trim()) errors.push(`${step.name} needs instructions.`);
    if (!step.expectedOutputs.length || step.expectedOutputs.some((output) => !output.trim()))
      errors.push(`${step.name} needs nonempty expected outputs.`);
    const binding = step.binding ?? project.project?.defaultBinding ?? null;
    if (!binding) errors.push(`${step.name} needs a project default or step binding.`);
    else {
      const error = bindingError(binding, agents);
      if (error) errors.push(`${step.name}: ${error}`);
    }
  }
  return errors;
};

/** Editor history, focus, draft persistence and publication. */
export const useLoopEditorController = ({
  initial,
  project,
  agents,
  onPublished,
}: {
  initial: LoopDefinition;
  project: ProjectResponse;
  agents: AgentConnection[];
  onPublished: (loop: LoopDefinition) => Promise<void>;
}) => {
  const [history, setHistory] = useState<History>({ present: initial, past: [], future: [] });
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const backRef = useRef<HTMLButtonElement>(null);
  const focusReturn = useRef<HTMLElement | null>(null);
  const loop = history.present;
  const selected = loop.steps.find((step) => step.id === selectedId);
  const dirty = JSON.stringify(loop) !== saved;
  useEffect(() => {
    if (selectedId && !selected) {
      const timeout = setTimeout(() => {
        setSelectedId(null);
        (focusReturn.current?.isConnected ? focusReturn.current : backRef.current)?.focus();
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [selectedId, selected]);
  // A run of coalescing applies (arrow-key moves) owns ONE undo entry: the one its first apply
  // pushed. `depth` is that entry's position, `present` the loop it left. A later apply folds into
  // it only while the key matches, the loop is still that exact object and the entry is still the
  // latest one; any other edit, Undo or Redo breaks the run, and so does an apply that changes
  // nothing or folds the entry away.
  const run = useRef<{ key: string; present: LoopDefinition; depth: number } | null>(null);
  const apply = (
    action: (current: LoopDefinition) => LoopDefinition,
    options?: { coalesce?: string },
  ) => {
    if (busyRef.current) return false;
    try {
      const key = options?.coalesce;
      const folds =
        key !== undefined &&
        run.current?.key === key &&
        run.current.present === history.present &&
        run.current.depth === history.past.length;
      const next = action(history.present);
      const updated = folds ? amend(history, next) : commit(history, next);
      const owned = updated.past.length === history.past.length + (folds ? 0 : 1);
      run.current =
        key !== undefined && updated !== history && owned
          ? { key, present: updated.present, depth: updated.past.length }
          : null;
      setHistory(updated);
      setMessage("");
      return true;
    } catch (cause) {
      setMessage(describeError(cause));
      return false;
    }
  };
  const openDrawer = (id: string, origin?: HTMLElement) => {
    focusReturn.current =
      origin ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSelectedId(id);
  };
  const closeDrawer = () => {
    setSelectedId(null);
    setTimeout(
      () => (focusReturn.current?.isConnected ? focusReturn.current : backRef.current)?.focus(),
      0,
    );
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedId && !busyRef.current) {
        event.preventDefault();
        closeDrawer();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (!busyRef.current)
          setHistory((current) => (event.shiftKey ? redo(current) : undo(current)));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId]);
  const save = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await api(`/api/loops/${loop.id}/draft`, loopResponseSchema.parse, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loop),
      });
      setSaved(JSON.stringify(response.loop));
      setMessage("Draft saved to the project.");
    } catch (cause) {
      setMessage(describeError(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const publish = async () => {
    if (busyRef.current) return;
    try {
      const errors = publicationErrors(loop, project, agents);
      if (errors.length) {
        setMessage(errors.join(" "));
        return;
      }
      busyRef.current = true;
      setBusy(true);
      await api(`/api/loops/${loop.id}/draft`, loopResponseSchema.parse, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loop),
      });
      const response = await api(`/api/loops/${loop.id}/publish`, loopResponseSchema.parse, {
        method: "POST",
      });
      const next = parseLoop({ ...loop, version: response.loop.version + 1, status: "draft" });
      setHistory({ present: next, past: [], future: [] });
      setSaved(JSON.stringify(next));
      setMessage(
        `Published immutable version ${response.loop.version}. Future edits target draft v${next.version}.`,
      );
      await onPublished(response.loop);
    } catch (cause) {
      setMessage(describeError(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return {
    history,
    setHistory,
    loop,
    selected,
    dirty,
    message,
    setMessage,
    busy,
    backRef,
    apply,
    openDrawer,
    closeDrawer,
    save,
    publish,
  };
};
