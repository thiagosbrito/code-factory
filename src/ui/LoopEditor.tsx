import { useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import type { AgentConnection } from "../adapters/contract.js";
import { parseLoop, type LoopDefinition } from "../domain/loop.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ProjectResponse } from "./project-api";
import { bindingError } from "./connection";
import { LoopStepDrawer } from "./LoopStepDrawer";
import { LoopStageBoard } from "./LoopStageBoard";
import { LoopPalette } from "./LoopPalette";
import { commit, redo, undo, type History } from "./loop-editor-model";

function describeError(error: unknown): string {
  if (error instanceof ZodError) return error.issues.map((issue) => issue.message).join("; ");
  return error instanceof Error ? error.message : String(error);
}

function publicationErrors(
  loop: LoopDefinition,
  project: ProjectResponse,
  agents: AgentConnection[],
): string[] {
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
}

export function LoopEditor({
  initial,
  project,
  agents,
  onBack,
  onPublished,
}: {
  initial: LoopDefinition;
  project: ProjectResponse;
  agents: AgentConnection[];
  onBack: () => void;
  onPublished: (loop: LoopDefinition) => Promise<void>;
}) {
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
  const apply = (action: (current: LoopDefinition) => LoopDefinition) => {
    if (busyRef.current) return false;
    try {
      setHistory(commit(history, action(history.present)));
      setMessage("");
      return true;
    } catch (cause) {
      setMessage(describeError(cause));
      return false;
    }
  };
  const openDrawer = (id: string, origin?: HTMLElement) => {
    focusReturn.current = origin ?? (document.activeElement as HTMLElement);
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
      const response = await api<{ loop: LoopDefinition }>(`/api/loops/${loop.id}/draft`, {
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
      await api(`/api/loops/${loop.id}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loop),
      });
      const response = await api<{ loop: LoopDefinition }>(`/api/loops/${loop.id}/publish`, {
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
  return (
    <div className="mt-5 min-h-[680px] rounded-xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-3">
          <Button ref={backRef} variant="ghost" disabled={busy} onClick={onBack}>
            ← Loops
          </Button>
          <span className="h-6 border-l" />
          <div className="text-xs text-muted-foreground">
            <label htmlFor="loop-title">Loop title</label>
            <Input
              id="loop-title"
              aria-label="Loop title"
              value={loop.name}
              disabled={busy}
              onChange={(event) =>
                apply((current) => parseLoop({ ...current, name: event.target.value }))
              }
              className="mt-1 w-64"
            />
          </div>
          <span className="text-xs text-muted-foreground">Draft v{loop.version}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || !history.past.length}
            onClick={() => setHistory(undo)}
          >
            Undo
          </Button>
          <Button
            variant="outline"
            disabled={busy || !history.future.length}
            onClick={() => setHistory(redo)}
          >
            Redo
          </Button>
          <Button variant="outline" disabled={busy || !dirty} onClick={() => void save()}>
            Save draft
          </Button>
          <Button disabled={busy} onClick={() => void publish()}>
            Publish v{loop.version}
          </Button>
        </div>
      </div>
      {message && (
        <p role="alert" className="mx-4 mt-3 rounded-md border bg-amber-50 p-2 text-sm">
          {message}
        </p>
      )}
      <fieldset disabled={busy} className="grid min-h-[590px] lg:grid-cols-[210px_minmax(0,1fr)]">
        <LoopPalette loop={loop} apply={apply} setMessage={setMessage} />
        <LoopStageBoard loop={loop} apply={apply} openDrawer={openDrawer} setMessage={setMessage} />
      </fieldset>
      {selected && (
        <LoopStepDrawer
          key={selected.id}
          loop={loop}
          selected={selected}
          project={project}
          agents={agents}
          message={message}
          apply={apply}
          closeDrawer={closeDrawer}
          busy={busy}
        />
      )}
    </div>
  );
}
