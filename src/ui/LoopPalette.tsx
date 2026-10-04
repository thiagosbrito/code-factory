import { useState } from "react";
import type { LoopDefinition } from "../domain/loop.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addStep,
  assignStepToGroup,
  removeGroup,
  setParallelGroup,
  setRepeatGroup,
} from "./loop-editor-model";

const field = "mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm";

export function LoopPalette({
  loop,
  apply,
  setMessage,
}: {
  loop: LoopDefinition;
  apply: (action: (current: LoopDefinition) => LoopDefinition) => boolean;
  setMessage: (message: string) => void;
}) {
  const [members, setMembers] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [repeatLimit, setRepeatLimit] = useState(2);
  const [exitStep, setExitStep] = useState("");
  const [exitOutcome, setExitOutcome] = useState("pass");
  const [exitTarget, setExitTarget] = useState("");
  const [continueOutcome, setContinueOutcome] = useState("repair");
  const [continueTarget, setContinueTarget] = useState("");
  return (
    <aside className="border-r p-4">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Step types
      </h3>
      <p className="mt-2 text-xs text-muted-foreground">
        Add a step, then use its explicit connection targets to change execution order.
      </p>
      <Button
        className="mt-4 w-full"
        variant="outline"
        onClick={() => apply((current) => addStep(current, "implementation", "agent"))}
      >
        + Agent step
      </Button>
      <Button
        className="mt-2 w-full"
        variant="outline"
        onClick={() => apply((current) => addStep(current, "validation", "check"))}
      >
        + Check step
      </Button>
      <div className="mt-6 border-t pt-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Groups
        </h3>
        <p className="mt-2 text-xs text-muted-foreground">
          Select members to create a semantic parallel or bounded repeat group.
        </p>
        <Input
          aria-label="Group name"
          placeholder="Group name"
          className="mt-3"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
        />
        {loop.steps.map((step) => (
          <label key={step.id} className="mt-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={members.includes(step.id)}
              onChange={() =>
                setMembers((current) =>
                  current.includes(step.id)
                    ? current.filter((id) => id !== step.id)
                    : [...current, step.id],
                )
              }
            />
            {step.name}
          </label>
        ))}
        <Button
          className="mt-3 w-full"
          variant="outline"
          onClick={() => apply((current) => setParallelGroup(current, members, groupName))}
        >
          Create parallel group
        </Button>
        <label className="mt-4 block text-xs">
          Repeat limit
          <input
            className={field}
            type="number"
            min="1"
            max="10"
            value={repeatLimit}
            onChange={(event) => setRepeatLimit(Number(event.target.value))}
          />
        </label>
        <select
          aria-label="Repeat decision step"
          className={field}
          value={exitStep}
          onChange={(event) => setExitStep(event.target.value)}
        >
          <option value="">Exit decision step</option>
          {loop.steps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.name}
            </option>
          ))}
        </select>
        <Input
          aria-label="Exit outcome"
          className="mt-2"
          value={exitOutcome}
          onChange={(event) => setExitOutcome(event.target.value)}
        />
        <select
          aria-label="Exit target"
          className={field}
          value={exitTarget}
          onChange={(event) => setExitTarget(event.target.value)}
        >
          <option value="">Exit target</option>
          {loop.steps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.name}
            </option>
          ))}
        </select>
        <Input
          aria-label="Continue outcome"
          className="mt-2"
          value={continueOutcome}
          onChange={(event) => setContinueOutcome(event.target.value)}
        />
        <select
          aria-label="Continuation target"
          className={field}
          value={continueTarget}
          onChange={(event) => setContinueTarget(event.target.value)}
        >
          <option value="">Continuation target</option>
          {loop.steps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.name}
            </option>
          ))}
        </select>
        <Button
          className="mt-2 w-full"
          variant="outline"
          onClick={() =>
            apply((current) =>
              setRepeatGroup(
                current,
                members,
                groupName,
                repeatLimit,
                { stepId: exitStep, outcome: exitOutcome, to: exitTarget },
                { outcome: continueOutcome, to: continueTarget },
              ),
            )
          }
        >
          Create repeat group
        </Button>
        {loop.groups.map((group) => (
          <div key={group.id} className="mt-3 rounded border p-2 text-xs">
            <strong>{group.name}</strong> · {group.kind}
            <button
              type="button"
              aria-label={`Add selected step to group ${group.name}`}
              className="mt-2 block w-full rounded border border-dashed p-2 text-left text-teal-700 hover:bg-teal-50"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                apply((current) =>
                  assignStepToGroup(current, event.dataTransfer.getData("step-id"), group.id),
                );
              }}
              onClick={() => {
                const source = document.querySelector<HTMLInputElement>(
                  'input[name="move-source"]:checked',
                )?.value;
                if (source) apply((current) => assignStepToGroup(current, source, group.id));
                else setMessage("Select a step to move using its Move radio button.");
              }}
            >
              Add selected step here
            </button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => apply((current) => removeGroup(current, group.id))}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
    </aside>
  );
}
