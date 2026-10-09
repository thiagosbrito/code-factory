import type { LoopDefinition } from "../../../domain/loop.js";
import { Button } from "@/shared/components/button";
import { assignStepToGroup, removeGroup } from "./loop-editor-model";

export const LoopGroupList = ({
  loop,
  apply,
  setMessage,
}: {
  loop: LoopDefinition;
  apply: (action: (current: LoopDefinition) => LoopDefinition) => boolean;
  setMessage: (message: string) => void;
}) => (
  <div aria-label="Existing groups">
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
);
