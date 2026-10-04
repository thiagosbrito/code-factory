import { useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
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
  busy,
}: {
  loop: LoopDefinition;
  selected: EditorStep;
  project: ProjectResponse;
  agents: AgentConnection[];
  message: string;
  apply: (action: (current: LoopDefinition) => LoopDefinition) => boolean;
  closeDrawer: () => void;
  busy: boolean;
}) {
  const existingJoin = loop.joins.find((item) => item.stepId === selected.id);
  const joinSignature = JSON.stringify(existingJoin ?? null);
  const decision = loop.decisions.find((item) => item.stepId === selected.id);
  const decisionSignature = JSON.stringify(decision ?? null);
  const existingBranches = decision?.branches ?? [];
  const [joinDraft, setJoinDraft] = useState(() => ({
    source: joinSignature,
    sources: existingJoin?.from ?? [],
    mode: existingJoin?.mode ?? ("all" as const),
  }));
  const [decisionDraft, setDecisionDraft] = useState(() => ({
    source: decisionSignature,
    branches: existingBranches.length
      ? existingBranches
      : [
          { outcome: "pass", to: "" },
          { outcome: "repair", to: "" },
        ],
  }));
  if (joinDraft.source !== joinSignature) {
    setJoinDraft({
      source: joinSignature,
      sources: existingJoin?.from ?? [],
      mode: existingJoin?.mode ?? "all",
    });
  }
  if (decisionDraft.source !== decisionSignature) {
    setDecisionDraft({
      source: decisionSignature,
      branches: decision?.branches ?? [
        { outcome: "pass", to: "" },
        { outcome: "repair", to: "" },
      ],
    });
  }
  const joinSources =
    joinDraft.source === joinSignature ? joinDraft.sources : (existingJoin?.from ?? []);
  const joinMode =
    joinDraft.source === joinSignature ? joinDraft.mode : (existingJoin?.mode ?? "all");
  const branches =
    decisionDraft.source === decisionSignature
      ? decisionDraft.branches
      : (decision?.branches ?? [
          { outcome: "pass", to: "" },
          { outcome: "repair", to: "" },
        ]);
  const [branchOne, branchTwo, ...extraBranches] = branches;
  const updateBranch = (index: number, patch: Partial<(typeof branches)[number]>) =>
    setDecisionDraft({
      source: decisionSignature,
      branches: branches.map((branch, position) =>
        position === index ? { ...branch, ...patch } : branch,
      ),
    });
  const drawerRef = useRef<HTMLInputElement>(null);
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
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) closeDrawer();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <DialogPrimitive.Content
          aria-label="Step configuration"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            drawerRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-white shadow-2xl focus:outline-none"
        >
          <fieldset disabled={busy} className="flex min-h-0 flex-1 flex-col">
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
                Configure the step and its semantic connections. Changes affect future versions
                only.
              </p>
              {message && (
                <p
                  role="alert"
                  className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs"
                >
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
                          setJoinDraft({
                            source: joinSignature,
                            sources: joinSources.includes(step.id)
                              ? joinSources.filter((id) => id !== step.id)
                              : [...joinSources, step.id],
                            mode: joinMode,
                          })
                        }
                      />
                      {step.name}
                    </label>
                  ))}
                <select
                  aria-label="Join mode"
                  className={field}
                  value={joinMode}
                  onChange={(event) =>
                    setJoinDraft({
                      source: joinSignature,
                      sources: joinSources,
                      mode: event.target.value as "all" | "any",
                    })
                  }
                >
                  <option value="all">All</option>
                  <option value="any">Any</option>
                </select>
                <Button
                  className="mt-2"
                  variant="outline"
                  onClick={() =>
                    apply((current) => setJoin(current, selected.id, joinSources, joinMode))
                  }
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
                    value={branchOne?.outcome ?? ""}
                    onChange={(event) => updateBranch(0, { outcome: event.target.value })}
                  />
                  <select
                    aria-label="First target"
                    className={field}
                    value={branchOne?.to ?? ""}
                    onChange={(event) => updateBranch(0, { to: event.target.value })}
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
                    value={branchTwo?.outcome ?? ""}
                    onChange={(event) => updateBranch(1, { outcome: event.target.value })}
                  />
                  <select
                    aria-label="Second target"
                    className={field}
                    value={branchTwo?.to ?? ""}
                    onChange={(event) => updateBranch(1, { to: event.target.value })}
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
                      onChange={(event) => updateBranch(index + 2, { outcome: event.target.value })}
                    />
                    <select
                      aria-label={`Target ${index + 3}`}
                      className={field}
                      value={branch.to}
                      onChange={(event) => updateBranch(index + 2, { to: event.target.value })}
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
                        setDecisionDraft({
                          source: decisionSignature,
                          branches: branches.filter((_, position) => position !== index + 2),
                        })
                      }
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <Button
                  className="mt-2"
                  variant="ghost"
                  onClick={() =>
                    setDecisionDraft({
                      source: decisionSignature,
                      branches: [...branches, { outcome: "", to: "" }],
                    })
                  }
                >
                  Add branch
                </Button>
                <Button
                  className="mt-2"
                  variant="outline"
                  onClick={() => apply((current) => setDecision(current, selected.id, branches))}
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
          </fieldset>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
