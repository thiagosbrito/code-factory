// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { RunDetail } from "../src/ui/features/runs/RunDetail.js";
import { RunGraph, rowSpacing } from "../src/ui/features/runs/RunGraph.js";
import { RunsList } from "../src/ui/features/runs/RunsList.js";
import { makeRun } from "./support/runs-ui.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#");
});

it("renders dependency connectors with the graph arrow marker", () => {
  const { container } = render(
    <RunGraph run={makeRun()} selectedStepId={null} onSelect={vi.fn<(id: string) => void>()} />,
  );
  const marker = container.querySelector("marker#run-graph-arrow");
  const connectors = container.querySelectorAll("path[marker-end]");
  expect(marker).toBeTruthy();
  expect(connectors).toHaveLength(2);
  for (const connector of connectors) {
    expect(connector.getAttribute("marker-end")).toBe("url(#run-graph-arrow)");
  }
});

it("filters runtime history and opens the exact run", async () => {
  const first = makeRun();
  const second = {
    ...makeRun(),
    snapshot: {
      ...makeRun().snapshot,
      id: crypto.randomUUID(),
      task: { description: "Second task" },
    },
    status: "failed" as const,
  };
  const onOpen = vi.fn<(id: string) => void>();
  render(<RunsList runs={[first, second]} onOpen={onOpen} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Failed" }));
  expect(screen.queryByText("First task")).toBeNull();
  expect(screen.getByText("Second task")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: /Second task/ }));
  expect(onOpen).toHaveBeenCalledWith(second.snapshot.id);
});

it("shows simultaneous active nodes and isolates the drawer to selected attempt", async () => {
  const run = makeRun();
  render(
    <RunDetail
      run={run}
      connected
      executing={false}
      onExecute={vi.fn<() => void>()}
      onCancel={vi.fn<() => void>()}
      onBack={vi.fn<() => void>()}
      summary={null}
      accepting={false}
      onAccept={vi.fn<() => void>()}
    />,
  );
  expect(screen.getByText("2 active steps")).toBeTruthy();
  expect(screen.getByText("Parallel work · parallel")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: /Build, running/ }));
  expect(screen.getByText("Build message")).toBeTruthy();
  expect(screen.queryByText("Review message")).toBeNull();
  await userEvent.setup().click(screen.getByRole("tab", { name: "Details" }));
  expect(screen.getByText("Build the work")).toBeTruthy();
  expect(screen.getByText("mock · model-a")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Run scope" }));
  await userEvent.setup().click(screen.getByRole("tab", { name: "Activity" }));
  expect(screen.getByText("Review message")).toBeTruthy();
  expect(screen.getAllByText("Build message").length).toBeGreaterThan(0);
});

it("centers a lone step vertically on its parallel neighbours without moving it sideways", () => {
  const run = makeRun();
  // Without saved positions the graph lays steps out itself: plan alone, then two in parallel.
  const steps = run.snapshot.loop.steps.map(({ position: _position, ...step }) => step);
  const laidOut = { ...run, snapshot: { ...run.snapshot, loop: { ...run.snapshot.loop, steps } } };
  render(<RunGraph run={laidOut} selectedStepId={null} onSelect={vi.fn<(id: string) => void>()} />);
  const at = (id: string) => {
    const node = document.getElementById(`run-node-${id}`);
    return { left: node?.style.left, top: node?.style.top };
  };
  expect(at("build")).toEqual({ left: "330px", top: "55px" });
  expect(at("review")).toEqual({ left: "330px", top: `${55 + rowSpacing}px` });
  expect(at("plan")).toEqual({ left: "40px", top: `${55 + rowSpacing / 2}px` });
});
