import { useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { AgentConnection } from "../../../adapters/contract.js";
import { parseLoop, type LoopDefinition } from "../../../domain/loop.js";
import { Button } from "@/shared/components/button";
import { Input } from "@/shared/components/input";
import { Textarea } from "@/shared/components/textarea";
import type { ProjectResponse } from "../../shared/project-api";
import { StepBindingSelectors } from "../../shared/StepBindingSelectors";
import { LoopJoinSection, LoopDecisionSection } from "./LoopGraphSections";
import { deleteStep, stageOf, type EditorStep } from "./loop-editor-model";
import { nudgeStepRight } from "./loop-editor-placement";

const label = "block w-full text-sm font-medium";
export const LoopStepDrawer = ({
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
}) => {
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
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-card shadow-2xl focus:outline-none"
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
              <label htmlFor="step-instructions" className={`${label} mt-4`}>
                Instructions
                <Textarea
                  id="step-instructions"
                  className="mt-1 min-h-32"
                  value={selected.instruction}
                  onChange={(event) => updateStep({ instruction: event.target.value })}
                />
              </label>
              <label htmlFor="step-outputs" className={`${label} mt-4`}>
                Expected outputs (one per line)
                <Textarea
                  id="step-outputs"
                  className="mt-1 min-h-20"
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
              <LoopJoinSection loop={loop} selected={selected} apply={apply} />
              <LoopDecisionSection loop={loop} selected={selected} apply={apply} />
              <div className="mt-6 border-t pt-4">
                <h4 className="font-semibold">Canvas position</h4>
                <Button
                  className="mt-2"
                  variant="outline"
                  onClick={() => apply((current) => nudgeStepRight(current, selected.id))}
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
};
