// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import type { LaneFlowNode } from "../src/ui/features/loops/graph/graph-mapping.js";
import { LaneActionsProvider } from "../src/ui/features/loops/graph/LaneActions.js";
import { LaneNode } from "../src/ui/features/loops/graph/LaneNode.js";

const props = {
  id: "lane:validation",
  data: { stage: "validation", title: "5. Validate", description: "Checks" },
} as unknown as NodeProps<LaneFlowNode>;

const lane = (actions: { addStep: (stage: string) => void } | null) => (
  <ReactFlowProvider>
    <LaneActionsProvider value={actions as never}>
      <LaneNode {...props} />
    </LaneActionsProvider>
  </ReactFlowProvider>
);

describe("Graph lane header", () => {
  afterEach(cleanup);

  it("adds a step to its own lane through an accessibly named button", async () => {
    const addStep = vi.fn<(stage: string) => void>();
    render(lane({ addStep }));
    await userEvent.click(screen.getByRole("button", { name: "Add step to 5. Validate" }));
    expect(addStep).toHaveBeenCalledExactlyOnceWith("validation");
  });

  it("offers no add control without actions", () => {
    render(lane(null));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("heading", { name: "5. Validate" })).toBeTruthy();
  });
});
