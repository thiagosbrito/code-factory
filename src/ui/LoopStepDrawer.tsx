import { useEffect, useRef, useState, type RefObject } from "react";
import type { AgentConnection } from "../adapters/contract.js";
import { parseLoop, type LoopDefinition } from "../domain/loop.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectResponse } from "./project-api";
import { StepBindingSelectors } from "./StepBindingSelectors";
import {
  deleteStep,
  moveVisual,
  removeDecision,
  removeJoin,
  setDecision,
  setJoin,
  stageOf,
  type EditorStep,
} from "./loop-editor-model";

const label = "block w-full text-sm font-medium";
const field = "mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm";

export function LoopStepDrawer({
  loop,
  selected,
  project,
  agents,
  message,
  apply,
  closeDrawer,
  dialogRef,
}: {
  loop: LoopDefinition;
  selected: EditorStep;
  project: ProjectResponse;
  agents: AgentConnection[];
  message: string;
  apply: (action: (current: LoopDefinition) => LoopDefinition) => boolean;
  closeDrawer: () => void;
  dialogRef: RefObject<HTMLDialogElement | null>;
}) {
  const existingJoin = loop.joins.find((item) => item.stepId === selected.id);
  const existingBranches =
    loop.decisions.find((item) => item.stepId === selected.id)?.branches ?? [];
  const [joinSources, setJoinSources] = useState<string[]>(existingJoin?.from ?? []);
  const [joinMode, setJoinMode] = useState<"all" | "any">(existingJoin?.mode ?? "all");
  const [branchOne, setBranchOne] = useState(existingBranches[0]?.outcome ?? "pass");
  const [branchTwo, setBranchTwo] = useState(existingBranches[1]?.outcome ?? "repair");
  const [targetOne, setTargetOne] = useState(existingBranches[0]?.to ?? "");
  const [targetTwo, setTargetTwo] = useState(existingBranches[1]?.to ?? "");
  const [extraBranches, setExtraBranches] = useState<{ outcome: string; to: string }[]>(
    existingBranches.slice(2),
  );
  const drawerRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    drawerRef.current?.focus();
  }, []);
  const updateStep = (patch: Partial<EditorStep>) =>
    apply((current) =>
      parseLoop({
        ...current,
        steps: current.steps.map((step) =>
          step.id === selected.id ? { ...step, ...patch } : step,
        ),
      }),
    );
  return (
    <dialog
      ref={dialogRef}
      open
      aria-modal="true"
      aria-label="Step configuration"
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l bg-white shadow-2xl"
    >
      <div className="flex items-start justify-between border-b p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-teal-700">
            Step configuration
          </p>
          <h3 className="mt-2 text-lg font-semibold">{selected.name}</h3>
          <small className="text-muted-foreground">{stageOf(selected)} · Draft only</small>
        </div>
        <Button variant="ghost" onClick={closeDrawer} aria-label="Close step configuration">
          ×
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <p className="rounded border bg-stone-50 p-3 text-xs">
          Configure the step and its semantic connections. Changes affect future versions only.
        </p>
        {message && (
          <p role="alert" className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs">
            {message}
          </p>
        )}
        <div className={`${label} mt-4`}>
          <label htmlFor="step-title">Title</label>
          <Input
            id="step-title"
            ref={drawerRef}
            value={selected.name}
            onChange={(event) => updateStep({ name: event.target.value })}
          />
        </div>
        <div className={`${label} mt-4`}>
          <label htmlFor="step-role">Role</label>
          <Input
            id="step-role"
            value={selected.role}
            onChange={(event) => updateStep({ role: event.target.value })}
          />
        </div>
        <label className={`${label} mt-4`}>
          Instructions
          <textarea
            className={`${field} min-h-32`}
            value={selected.instruction}
            onChange={(event) => updateStep({ instruction: event.target.value })}
          />
        </label>
        <label className={`${label} mt-4`}>
          Expected outputs (one per line)
          <textarea
            className={`${field} min-h-20`}
            value={selected.expectedOutputs.join("\n")}
            onChange={(event) =>
              updateStep({
                expectedOutputs: event.target.value.split("\n"),
              })
            }
          />
        </label>
        <div className="mt-5">
          <StepBindingSelectors
            value={selected.binding ?? null}
            onChange={(binding) => updateStep({ binding: binding ?? undefined })}
            agents={agents}
            projectDefault={project.project?.defaultBinding ?? null}
          />
        </div>
        <div className="mt-6 border-t pt-4">
          <h4 className="font-semibold">Join</h4>
          <p className="text-xs text-muted-foreground">
            Choose two or more predecessors and whether all or any must finish.
          </p>
          {loop.steps
            .filter((step) => step.id !== selected.id)
            .map((step) => (
              <label key={step.id} className="mt-2 flex gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={joinSources.includes(step.id)}
                  onChange={() =>
                    setJoinSources((current) =>
                      current.includes(step.id)
                        ? current.filter((id) => id !== step.id)
                        : [...current, step.id],
                    )
                  }
                />
                {step.name}
              </label>
            ))}
          <select
            aria-label="Join mode"
            className={field}
            value={joinMode}
            onChange={(event) => setJoinMode(event.target.value as "all" | "any")}
          >
            <option value="all">All</option>
            <option value="any">Any</option>
          </select>
          <Button
            className="mt-2"
            variant="outline"
            onClick={() => apply((current) => setJoin(current, selected.id, joinSources, joinMode))}
          >
            Set join
          </Button>
          {loop.joins.some((join) => join.stepId === selected.id) && (
            <Button
              className="mt-2 ml-2"
              variant="ghost"
              onClick={() => apply((current) => removeJoin(current, selected.id))}
            >
              Remove join
            </Button>
          )}
        </div>
        <div className="mt-6 border-t pt-4">
          <h4 className="font-semibold">Decision branches</h4>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Input
              aria-label="First outcome"
              value={branchOne}
              onChange={(event) => setBranchOne(event.target.value)}
            />
            <select
              aria-label="First target"
              className={field}
              value={targetOne}
              onChange={(event) => setTargetOne(event.target.value)}
            >
              <option value="">Target</option>
              {loop.steps
                .filter((step) => step.id !== selected.id)
                .map((step) => (
                  <option key={step.id} value={step.id}>
                    {step.name}
                  </option>
                ))}
            </select>
            <Input
              aria-label="Second outcome"
              value={branchTwo}
              onChange={(event) => setBranchTwo(event.target.value)}
            />
            <select
              aria-label="Second target"
              className={field}
              value={targetTwo}
              onChange={(event) => setTargetTwo(event.target.value)}
            >
              <option value="">Target</option>
              {loop.steps
                .filter((step) => step.id !== selected.id)
                .map((step) => (
                  <option key={step.id} value={step.id}>
                    {step.name}
                  </option>
                ))}
            </select>
          </div>
          {extraBranches.map((branch, index) => (
            <div key={index} className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input
                aria-label={`Outcome ${index + 3}`}
                value={branch.outcome}
                onChange={(event) =>
                  setExtraBranches((items) =>
                    items.map((item, position) =>
                      position === index ? { ...item, outcome: event.target.value } : item,
                    ),
                  )
                }
              />
              <select
                aria-label={`Target ${index + 3}`}
                className={field}
                value={branch.to}
                onChange={(event) =>
                  setExtraBranches((items) =>
                    items.map((item, position) =>
                      position === index ? { ...item, to: event.target.value } : item,
                    ),
                  )
                }
              >
                <option value="">Target</option>
                {loop.steps
                  .filter((step) => step.id !== selected.id)
                  .map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.name}
                    </option>
                  ))}
              </select>
              <Button
                variant="ghost"
                aria-label={`Remove branch ${index + 3}`}
                onClick={() =>
                  setExtraBranches((items) => items.filter((_, position) => position !== index))
                }
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            className="mt-2"
            variant="ghost"
            onClick={() => setExtraBranches((items) => [...items, { outcome: "", to: "" }])}
          >
            Add branch
          </Button>
          <Button
            className="mt-2"
            variant="outline"
            onClick={() =>
              apply((current) =>
                setDecision(current, selected.id, [
                  { outcome: branchOne, to: targetOne },
                  { outcome: branchTwo, to: targetTwo },
                  ...extraBranches,
                ]),
              )
            }
          >
            Set decision
          </Button>
          {loop.decisions.some((decision) => decision.stepId === selected.id) && (
            <Button
              className="mt-2 ml-2"
              variant="ghost"
              onClick={() => apply((current) => removeDecision(current, selected.id))}
            >
              Remove decision
            </Button>
          )}
        </div>
        <div className="mt-6 border-t pt-4">
          <h4 className="font-semibold">Canvas position</h4>
          <Button
            className="mt-2"
            variant="outline"
            onClick={() =>
              apply((current) =>
                moveVisual(
                  current,
                  selected.id,
                  (selected.position?.x ?? 0) + 20,
                  selected.position?.y ?? 0,
                ),
              )
            }
          >
            Nudge visual right
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Presentation only; execution dependencies stay the same.
          </p>
        </div>
      </div>
      <div className="flex justify-between border-t p-4">
        <Button
          variant="outline"
          onClick={() => {
            if (apply((current) => deleteStep(current, selected.id))) closeDrawer();
          }}
        >
          Delete step
        </Button>
        <Button onClick={closeDrawer}>Done</Button>
      </div>
    </dialog>
  );
}
