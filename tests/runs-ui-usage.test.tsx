// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RunRecord } from "../src/domain/run.js";
import { summarizeUsage, type UsageReport } from "../src/domain/usage.js";
import { RunGraph } from "../src/ui/features/runs/RunGraph.js";
import { RunInspectorDetails } from "../src/ui/features/runs/RunInspectorDetails.js";
import { RunUsageTotal } from "../src/ui/features/runs/RunUsage.js";
import { makeRun } from "./support/runs-ui.js";

afterEach(cleanup);

const estimate = (amount: number) => ({
  amount,
  currency: "USD" as const,
  source: "provider-estimate" as const,
});

/** The fixture's two attempts, ended, with the given reports (build, review) in order. */
const withUsage = (reports: (UsageReport | null)[], ended = true): RunRecord => {
  const run = structuredClone(makeRun());
  const stepIds = ["build", "review"];
  stepIds.forEach((stepId, index) => {
    const attempt = run.steps.find((step) => step.stepId === stepId)?.attempts[0];
    if (!attempt) throw new Error("fixture has no attempt");
    if (ended) {
      attempt.status = "succeeded";
      attempt.endedAt = new Date().toISOString();
    }
    const report = reports[index];
    if (report)
      run.evidence.push({
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId,
        attemptId: attempt.id,
        createdAt: new Date().toISOString(),
        kind: "usage",
        ...report,
      });
  });
  return run;
};

const card = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}, `, "u") });
const renderGraph = (run: RunRecord) =>
  render(<RunGraph run={run} selectedStepId={null} onSelect={vi.fn<(id: string) => void>()} />);

it("says a finished step reported no usage, never zero", () => {
  renderGraph(withUsage([null, null]));
  expect(within(card("Build")).getByText("Usage not reported")).toBeTruthy();
  expect(card("Build").textContent).not.toMatch(/\b0\b.*(in|out)/u);
});

it("shows nothing while a step's only attempt is still running and has reported nothing", () => {
  renderGraph(withUsage([null, null], false));
  expect(within(card("Build")).queryByTestId("step-usage")).toBeNull();
});

it("shows tokens and an estimated cost with its unit, keeping a reported zero", () => {
  renderGraph(
    withUsage([
      { tokens: { input: 12345, output: 0 }, cost: estimate(0.0123) },
      { tokens: { input: 7, output: 2 }, cost: estimate(0) },
    ]),
  );
  const build = within(card("Build")).getByTestId("step-usage").textContent;
  expect(build).toBe("12,345 in · 0 out · est. $0.0123 USD");
  expect(within(card("Review")).getByTestId("step-usage").textContent).toContain(
    "est. $0.0000 USD",
  );
});

it("names the missing half of a report", () => {
  renderGraph(withUsage([{ cost: estimate(1.5) }, { tokens: { cacheRead: 3 } }]));
  expect(within(card("Build")).getByTestId("step-usage").textContent).toBe(
    "Tokens not reported · est. $1.50 USD",
  );
  expect(within(card("Review")).getByTestId("step-usage").textContent).toBe(
    "Input/output tokens not reported · Cost not reported",
  );
});

it("totals the run and labels a partial total", () => {
  const run = withUsage([{ tokens: { input: 10, output: 5 }, cost: estimate(0.5) }, null]);
  render(<RunUsageTotal usage={summarizeUsage(run)} />);
  expect(screen.getByText(/Usage: 10 in · 5 out · est\. \$0\.5000 USD \(partial\)/u)).toBeTruthy();
});

it("totals two reporting attempts without partial wording", () => {
  const run = withUsage([{ tokens: { input: 10 } }, { tokens: { input: 5, output: 1 } }]);
  render(<RunUsageTotal usage={summarizeUsage(run)} />);
  expect(screen.getByText(/Usage: 15 in · 1 out/u).textContent).not.toContain("partial");
});

it("shows nothing for a run that has no attempts", () => {
  const run = structuredClone(makeRun());
  for (const step of run.steps) step.attempts = [];
  const { container } = render(<RunUsageTotal usage={summarizeUsage(run)} />);
  expect(container.textContent).toBe("");
});

it("details a step's usage in the inspector, with its unit, source, coverage and note", () => {
  const run = withUsage([
    {
      tokens: { input: 100, output: 20, cacheRead: 3 },
      cost: estimate(0.04),
      note: "Subagent tokens are not included.",
    },
    null,
  ]);
  render(
    <RunInspectorDetails
      run={run}
      scope={{ kind: "step", stepId: "build", attemptId: null }}
      summary={null}
    />,
  );
  const usage = within(screen.getByLabelText("Usage"));
  expect(usage.getByText("Input tokens").nextElementSibling?.textContent).toBe("100");
  expect(usage.getByText("Cache write tokens").nextElementSibling?.textContent).toBe(
    "Not reported",
  );
  expect(usage.getByText("Cost").nextElementSibling?.textContent).toBe(
    "$0.0400 USD, estimated by the provider",
  );
  expect(usage.getByText("Coverage").nextElementSibling?.textContent).toBe(
    "1 of 1 attempt reported",
  );
  expect(usage.getByText("Subagent tokens are not included.")).toBeTruthy();
});

it("says in the inspector when an attempt reported nothing, and scopes the run to all steps", () => {
  const run = withUsage([{ tokens: { input: 4 } }, null]);
  const { rerender } = render(
    <RunInspectorDetails
      run={run}
      scope={{ kind: "step", stepId: "review", attemptId: null }}
      summary={null}
    />,
  );
  expect(within(screen.getByLabelText("Usage")).getByText(/Not reported: the agent/u)).toBeTruthy();
  rerender(<RunInspectorDetails run={run} scope={{ kind: "run" }} summary={null} />);
  const total = within(screen.getByLabelText("Usage"));
  expect(total.getByText("Coverage").nextElementSibling?.textContent).toBe(
    "Partial: 1 of 2 attempts reported",
  );
});
