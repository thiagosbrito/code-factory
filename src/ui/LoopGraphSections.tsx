import { useState } from "react";
import type { LoopDefinition } from "../domain/loop.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  removeDecision,
  removeJoin,
  setDecision,
  setJoin,
  type EditorStep,
} from "./loop-editor-model";

type SectionProps = {
  loop: LoopDefinition;
  selected: EditorStep;
  apply: (action: (current: LoopDefinition) => LoopDefinition) => boolean;
};

export const LoopJoinSection = ({ loop, selected, apply }: SectionProps) => {
  const existingJoin = loop.joins.find((item) => item.stepId === selected.id);
  const joinSignature = JSON.stringify(existingJoin ?? null);
  const [joinDraft, setJoinDraft] = useState(() => ({
    source: joinSignature,
    sources: existingJoin?.from ?? [],
    mode: existingJoin?.mode ?? ("all" as const),
  }));
  if (joinDraft.source !== joinSignature) {
    setJoinDraft({
      source: joinSignature,
      sources: existingJoin?.from ?? [],
      mode: existingJoin?.mode ?? "all",
    });
  }
  const joinSources =
    joinDraft.source === joinSignature ? joinDraft.sources : (existingJoin?.from ?? []);
  const joinMode =
    joinDraft.source === joinSignature ? joinDraft.mode : (existingJoin?.mode ?? "all");
  return (
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
      <NativeSelect
        aria-label="Join mode"
        className="mt-2"
        value={joinMode}
        onChange={(event) =>
          setJoinDraft({
            source: joinSignature,
            sources: joinSources,
            mode: event.target.value === "any" ? "any" : "all",
          })
        }
      >
        <option value="all">All</option>
        <option value="any">Any</option>
      </NativeSelect>
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
  );
};

export const LoopDecisionSection = ({ loop, selected, apply }: SectionProps) => {
  const decision = loop.decisions.find((item) => item.stepId === selected.id);
  const decisionSignature = JSON.stringify(decision ?? null);
  const existingBranches = decision?.branches ?? [];
  const [decisionDraft, setDecisionDraft] = useState(() => ({
    source: decisionSignature,
    branches: existingBranches.length
      ? existingBranches
      : [
          { outcome: "pass", to: "" },
          { outcome: "repair", to: "" },
        ],
  }));
  if (decisionDraft.source !== decisionSignature) {
    setDecisionDraft({
      source: decisionSignature,
      branches: decision?.branches ?? [
        { outcome: "pass", to: "" },
        { outcome: "repair", to: "" },
      ],
    });
  }
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
  return (
    <div className="mt-6 border-t pt-4">
      <h4 className="font-semibold">Decision branches</h4>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Input
          aria-label="First outcome"
          value={branchOne?.outcome ?? ""}
          onChange={(event) => updateBranch(0, { outcome: event.target.value })}
        />
        <NativeSelect
          aria-label="First target"
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
        </NativeSelect>
        <Input
          aria-label="Second outcome"
          value={branchTwo?.outcome ?? ""}
          onChange={(event) => updateBranch(1, { outcome: event.target.value })}
        />
        <NativeSelect
          aria-label="Second target"
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
        </NativeSelect>
      </div>
      {extraBranches.map((branch, index) => (
        <div key={index} className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
          <Input
            aria-label={`Outcome ${index + 3}`}
            value={branch.outcome}
            onChange={(event) => updateBranch(index + 2, { outcome: event.target.value })}
          />
          <NativeSelect
            aria-label={`Target ${index + 3}`}
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
          </NativeSelect>
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
  );
};
