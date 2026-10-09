import { useState } from "react";
import type { LoopDefinition } from "../../../domain/loop.js";
import { Button } from "@/shared/components/button";
import { Input } from "@/shared/components/input";
import { NativeSelect } from "@/shared/components/native-select";
import { setParallelGroup, setRepeatGroup } from "./loop-editor-model";
import { LoopGroupList } from "./LoopGroupList";

export const LoopGroups = ({
  loop,
  apply,
  setMessage,
}: {
  loop: LoopDefinition;
  apply: (action: (current: LoopDefinition) => LoopDefinition) => boolean;
  setMessage: (message: string) => void;
}) => {
  const [members, setMembers] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [repeatLimit, setRepeatLimit] = useState(2);
  const [exitStep, setExitStep] = useState("");
  const [exitOutcome, setExitOutcome] = useState("pass");
  const [exitTarget, setExitTarget] = useState("");
  const [continueOutcome, setContinueOutcome] = useState("repair");
  const [continueTarget, setContinueTarget] = useState("");
  const liveMembers = members.filter((id) => loop.steps.some((step) => step.id === id));
  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Groups</h3>
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
            checked={liveMembers.includes(step.id)}
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
        onClick={() => apply((current) => setParallelGroup(current, liveMembers, groupName))}
      >
        Create parallel group
      </Button>
      <label htmlFor="repeat-limit" className="mt-4 block text-xs">
        Repeat limit
        <Input
          id="repeat-limit"
          className="mt-1"
          type="number"
          min="1"
          max="10"
          value={repeatLimit}
          onChange={(event) => setRepeatLimit(Number(event.target.value))}
        />
      </label>
      <NativeSelect
        aria-label="Repeat decision step"
        className="mt-2"
        value={exitStep}
        onChange={(event) => setExitStep(event.target.value)}
      >
        <option value="">Exit decision step</option>
        {loop.steps.map((step) => (
          <option key={step.id} value={step.id}>
            {step.name}
          </option>
        ))}
      </NativeSelect>
      <Input
        aria-label="Exit outcome"
        className="mt-2"
        value={exitOutcome}
        onChange={(event) => setExitOutcome(event.target.value)}
      />
      <NativeSelect
        aria-label="Exit target"
        className="mt-2"
        value={exitTarget}
        onChange={(event) => setExitTarget(event.target.value)}
      >
        <option value="">Exit target</option>
        {loop.steps.map((step) => (
          <option key={step.id} value={step.id}>
            {step.name}
          </option>
        ))}
      </NativeSelect>
      <Input
        aria-label="Continue outcome"
        className="mt-2"
        value={continueOutcome}
        onChange={(event) => setContinueOutcome(event.target.value)}
      />
      <NativeSelect
        aria-label="Continuation target"
        className="mt-2"
        value={continueTarget}
        onChange={(event) => setContinueTarget(event.target.value)}
      >
        <option value="">Continuation target</option>
        {loop.steps.map((step) => (
          <option key={step.id} value={step.id}>
            {step.name}
          </option>
        ))}
      </NativeSelect>
      <Button
        className="mt-2 w-full"
        variant="outline"
        onClick={() =>
          apply((current) =>
            setRepeatGroup(
              current,
              liveMembers,
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
      <LoopGroupList loop={loop} apply={apply} setMessage={setMessage} />
    </div>
  );
};
