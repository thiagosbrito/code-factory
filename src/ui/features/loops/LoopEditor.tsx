import { useMemo, useRef } from "react";
import type { AgentConnection } from "../../../adapters/contract.js";
import { parseLoop, type LoopDefinition } from "../../../domain/loop.js";
import { Button } from "@/shared/components/button";
import { Input } from "@/shared/components/input";
import type { ProjectResponse } from "../../shared/project-api";
import { stepFacts } from "../../shared/step-facts";
import { LoopStepDrawer } from "./LoopStepDrawer";
import { LoopStageBoard } from "./LoopStageBoard";
import { LoopPalette } from "./LoopPalette";
import { redo, undo } from "./loop-editor-model";
import { useLoopEditorController } from "./useLoopEditorController";
import { NativeTranslation } from "./NativeTranslation";
import { LazyLoopGraphView } from "./LazyLoopGraphView";
import { LoopViewSwitch } from "./LoopViewSwitch";
import { useLoopEditorView, type LoopEditorView } from "./loop-editor-view";

export const LoopEditor = ({
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
}) => {
  const {
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
  } = useLoopEditorController({ initial, project, agents, onPublished });
  const projectDefault = project.project?.defaultBinding ?? null;
  // Stable between renders that change nothing it reads, so the Graph's step cards do not all
  // re-render on every keystroke in the drawer.
  const factsOf = useMemo(
    () => (stepId: string) => {
      const step = loop.steps.find((item) => item.id === stepId);
      // A check step runs a shell command, never an agent, so it has no agent facts.
      return step && step.kind !== "check"
        ? stepFacts({ binding: step.binding, projectDefault, agents })
        : null;
    },
    [loop.steps, projectDefault, agents],
  );
  const { view, setView } = useLoopEditorView();
  const switchRef = useRef<HTMLFieldSetElement>(null);
  const focusSwitch = (target: LoopEditorView) =>
    switchRef.current?.querySelector<HTMLButtonElement>(`[data-view="${target}"]`)?.focus();
  return (
    <div className="mt-5 min-h-[680px] rounded-xl border bg-card shadow-sm">
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
        <div className="flex flex-wrap items-center gap-2">
          <LoopViewSwitch view={view} onChange={setView} switchRef={switchRef} />
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
      <NativeTranslation loop={loop} apply={apply} disabled={busy} />
      <fieldset disabled={busy} className="grid min-h-[590px] lg:grid-cols-[210px_minmax(0,1fr)]">
        <LoopPalette loop={loop} apply={apply} setMessage={setMessage} />
        {view === "board" ? (
          <LoopStageBoard
            loop={loop}
            stepFacts={factsOf}
            apply={apply}
            openDrawer={openDrawer}
            setMessage={setMessage}
          />
        ) : (
          <LazyLoopGraphView
            loop={loop}
            stepFacts={factsOf}
            apply={apply}
            openDrawer={openDrawer}
            onRetry={() => focusSwitch("graph")}
            onUseBoard={() => {
              setView("board");
              focusSwitch("board");
            }}
          />
        )}
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
};
