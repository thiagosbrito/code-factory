import type { LoopDefinition } from "../../../domain/loop.js";
import { Button } from "@/shared/components/button";
import { completePositions } from "./loop-editor-placement";
import { addStep, semanticDrop, stageOf, stages } from "./loop-editor-model";

export const LoopStageBoard = ({
  loop,
  apply,
  openDrawer,
  setMessage,
}: {
  loop: LoopDefinition;
  apply: (action: (current: LoopDefinition) => LoopDefinition) => boolean;
  openDrawer: (id: string, origin?: HTMLElement) => void;
  setMessage: (message: string) => void;
}) => {
  return (
    <div className="overflow-x-auto bg-[radial-gradient(var(--graph-dot)_.6px,transparent_.6px)] bg-[length:17px_17px] bg-[var(--graph-bg)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Execution stages</h3>
          <p className="text-xs text-muted-foreground">
            Drop only on labeled Before / After targets. Coordinates never change dependencies.
          </p>
        </div>
        <span className="rounded bg-card px-2 py-1 text-xs">Draft v{loop.version}</span>
      </div>
      <div className="mt-4 grid min-w-[900px] grid-cols-5 gap-3">
        {stages.map((stage) => (
          <section
            key={stage.id}
            aria-label={stage.name}
            className="min-h-72 rounded-lg border bg-card/75 p-2"
          >
            <div className="min-h-16 border-b p-1">
              <h4 className="text-sm font-semibold">{stage.name}</h4>
              <p className="text-[11px] text-muted-foreground">{stage.description}</p>
            </div>
            <div className="grid gap-2 py-3">
              {loop.steps
                .filter((step) => stageOf(step) === stage.id)
                .map((step) => {
                  const group = loop.groups.find((item) => item.id === step.groupId);
                  const predecessors = loop.dependencies
                    .filter((edge) => edge.to === step.id)
                    .map(
                      (edge) => loop.steps.find((item) => item.id === edge.from)?.name ?? edge.from,
                    );
                  return (
                    <div key={step.id} className="rounded-md border bg-card p-2 shadow-sm">
                      <div className="flex items-center gap-1">
                        <span aria-hidden="true" className="text-stone-400">
                          ⠿
                        </span>
                        <button
                          data-editor-step-id={step.id}
                          className="min-w-0 flex-1 text-left text-xs font-semibold hover:text-teal-700"
                          onClick={(event) => openDrawer(step.id, event.currentTarget)}
                        >
                          {step.name}
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {step.kind} · {group ? `${group.kind}: ${group.name}` : "ungrouped"}
                      </p>
                      {group?.kind === "repeat" && (
                        <p className="text-[10px] text-purple-700">
                          Up to {group.maxIterations} iterations · exit on {group.exitWhen.outcome}{" "}
                          · continue on {group.continueWhen.outcome}
                        </p>
                      )}
                      {predecessors.length > 0 && (
                        <p className="text-[10px] text-stone-600">
                          After: {predecessors.join(", ")}
                        </p>
                      )}
                      {loop.joins
                        .filter((join) => join.stepId === step.id)
                        .map((join) => (
                          <p key="join" className="text-[10px] text-purple-700">
                            Join {join.mode}: {join.from.length} sources
                          </p>
                        ))}
                      {loop.decisions
                        .filter((item) => item.stepId === step.id)
                        .map((item) => (
                          <p key="decision" className="text-[10px] text-amber-700">
                            Decision:{" "}
                            {item.branches
                              .map(
                                (branch) =>
                                  `${branch.outcome} → ${loop.steps.find((target) => target.id === branch.to)?.name ?? branch.to}`,
                              )
                              .join(" / ")}
                          </p>
                        ))}
                      <div className="mt-2 grid grid-cols-2 gap-1">
                        {(["before", "after"] as const).map((placement) => (
                          <button
                            key={placement}
                            aria-label={`${placement} ${step.name}`}
                            data-drop-target={placement}
                            className="rounded border border-dashed px-1 py-1 text-[10px] text-teal-700 hover:bg-teal-50 focus:bg-teal-50"
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              const source = event.dataTransfer.getData("step-id");
                              apply((current) =>
                                semanticDrop(current, source, { stepId: step.id, placement }),
                              );
                            }}
                            onClick={() => {
                              const source = document.querySelector<HTMLInputElement>(
                                'input[name="move-source"]:checked',
                              )?.value;
                              if (source)
                                apply((current) =>
                                  semanticDrop(current, source, { stepId: step.id, placement }),
                                );
                              else setMessage("Select a step to move using its Move radio button.");
                            }}
                          >
                            {placement}
                          </button>
                        ))}
                      </div>
                      <label className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <input
                          type="radio"
                          name="move-source"
                          value={step.id}
                          draggable
                          onDragStart={(event) => event.dataTransfer.setData("step-id", step.id)}
                        />
                        Move {step.name}
                      </label>
                    </div>
                  );
                })}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() =>
                apply((current) =>
                  completePositions(
                    addStep(current, stage.id, stage.id === "validation" ? "check" : "agent"),
                  ),
                )
              }
            >
              + Add step
            </Button>
          </section>
        ))}
      </div>
    </div>
  );
};
