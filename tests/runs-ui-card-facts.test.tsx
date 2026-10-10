// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RunGraph } from "../src/ui/features/runs/RunGraph.js";
import { makeRun } from "./support/runs-ui.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T10:01:05.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const withRunningPlan = () => {
  const run = makeRun();
  const plan = run.steps.find((step) => step.stepId === "plan");
  if (!plan) throw new Error("fixture has no plan step");
  plan.status = "running";
  plan.attempts = [
    {
      id: crypto.randomUUID(),
      status: "running",
      startedAt: "2026-10-10T10:00:00.000Z",
    } as (typeof plan.attempts)[number],
  ];
  run.snapshot.bindings.plan = { provider: "codex", model: "agent-default", effort: "high" };
  return run;
};

const planCard = () => screen.getByRole("button", { name: /^Plan, /u });

it("shows the resolved agent, model and effort on each run card", () => {
  render(
    <RunGraph
      run={withRunningPlan()}
      selectedStepId={null}
      onSelect={vi.fn<(id: string) => void>()}
    />,
  );
  const card = within(planCard());
  expect(card.getByText("Agent:").nextElementSibling?.textContent).toBe("Codex");
  expect(card.getByText("Model:").nextElementSibling?.textContent).toBe("Agent default");
  expect(card.getByText("Effort:").nextElementSibling?.textContent).toBe("high");
});

it("counts a running step's time up every second and stops when nothing runs", () => {
  const run = withRunningPlan();
  const { rerender } = render(
    <RunGraph run={run} selectedStepId={null} onSelect={vi.fn<(id: string) => void>()} />,
  );
  expect(planCard().textContent).toContain("1m 05s");
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(planCard().textContent).toContain("1m 08s");

  const finished = structuredClone(run);
  const attempt = finished.steps.find((step) => step.stepId === "plan")?.attempts[0];
  if (!attempt) throw new Error("fixture has no attempt");
  attempt.status = "succeeded";
  attempt.endedAt = "2026-10-10T10:01:10.000Z";
  rerender(
    <RunGraph run={finished} selectedStepId={null} onSelect={vi.fn<(id: string) => void>()} />,
  );
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  expect(planCard().textContent).toContain("1m 10s");
});
