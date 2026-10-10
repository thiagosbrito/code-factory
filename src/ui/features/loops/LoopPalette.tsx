import type { LoopDefinition } from "../../../domain/loop.js";
import { Button } from "@/shared/components/button";
import { completePositions } from "./graph/graph-layout";
import { addStep } from "./loop-editor-model";
import { LoopGroups } from "./LoopGroups";

export const LoopPalette = ({
  loop,
  apply,
  setMessage,
}: {
  loop: LoopDefinition;
  apply: (action: (current: LoopDefinition) => LoopDefinition) => boolean;
  setMessage: (message: string) => void;
}) => {
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
        onClick={() =>
          apply((current) => completePositions(addStep(current, "implementation", "agent")))
        }
      >
        + Agent step
      </Button>
      <Button
        className="mt-2 w-full"
        variant="outline"
        onClick={() =>
          apply((current) => completePositions(addStep(current, "validation", "check")))
        }
      >
        + Check step
      </Button>
      <LoopGroups loop={loop} apply={apply} setMessage={setMessage} />
    </aside>
  );
};
