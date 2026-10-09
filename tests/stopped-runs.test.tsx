// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import {
  createRunRecord,
  createRunSnapshot,
  finishAttempt,
  runRecordSchema,
  startAttempt,
  type RunRecord,
} from "../src/domain/run.js";
import { claimStep, completeStep } from "../src/domain/scheduler.js";
import { issueBlockedSentinel } from "../src/domain/ticket.js";
import { RunDetail } from "../src/ui/features/runs/RunDetail.js";
import { step } from "./support/run-branch-ui.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  location.hash = "";
});

const blockedRun = (): RunRecord => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps: [
      step("build", "implementation"),
      step("quality", "review"),
      step("adjudicate", "implementation"),
    ],
    dependencies: [
      { from: "build", to: "quality" },
      { from: "quality", to: "adjudicate" },
    ],
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 1 },
  });
  let run = createRunRecord(
    createRunSnapshot(loop, { description: "Task" }, { provider: "mock", model: "default" }),
  );
  run = completeStep(claimStep(run, "build", "c", "i"), "build", { status: "succeeded" });
  run = claimStep(run, "quality", "c", "i");
  const attemptId = run.steps.find((item) => item.stepId === "quality")?.attempts.at(-1)?.id ?? "";
  run = runRecordSchema.parse({
    ...run,
    revision: run.revision + 1,
    evidence: [
      ...run.evidence,
      {
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "quality",
        attemptId,
        createdAt: new Date().toISOString(),
        kind: "event",
        type: "lifecycle",
        title: "completed",
        detail: "blocked\nCannot run yarn test: shell refused.",
        state: "succeeded",
        sequence: 0,
      },
    ],
  });
  return completeStep(run, "quality", { status: "succeeded", outcome: "blocked" });
};

describe("stopped runs", () => {
  type Retry = (stepId: string, attemptId: string, focusTarget?: HTMLElement | null) => void;
  const detail = (run: RunRecord, onRetry = vi.fn<Retry>()) =>
    render(
      <RunDetail
        run={run}
        summary={null}
        accepting={false}
        onAccept={() => undefined}
        connected
        executing={false}
        onExecute={() => undefined}
        onCancel={() => undefined}
        onRetry={onRetry}
        onBack={() => undefined}
      />,
    );

  it("offers Cancel run next to Execute run for a pending run, which holds the project", async () => {
    const pending = createRunRecord(
      createRunSnapshot(
        parseLoop({
          schemaVersion: 2,
          id: "flow",
          name: "Flow",
          version: 1,
          status: "published",
          steps: [step("implement", "implementation")],
          dependencies: [],
          groups: [],
          joins: [],
          decisions: [],
          policy: {},
        }),
        { description: "Task" },
        { provider: "mock", model: "default" },
      ),
    );
    const onCancel = vi.fn<() => void>();
    render(
      <RunDetail
        run={pending}
        summary={null}
        accepting={false}
        onAccept={() => undefined}
        connected
        executing={false}
        onExecute={() => undefined}
        onCancel={onCancel}
        onRetry={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Execute run" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel run" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("offers Retry on the stopped step's node and in the floating bar over the canvas", async () => {
    const run = blockedRun();
    const onRetry = vi.fn<Retry>();
    detail(run, onRetry);
    const attemptId = run.steps.find((item) => item.stepId === "quality")?.attempts.at(-1)?.id;
    const graph = screen.getByRole("region", { name: "Execution graph" });
    const retries = within(graph).getAllByRole("button", { name: "Retry Test quality" });
    // One pinned to the node's corner, one in the floating bar.
    expect(retries).toHaveLength(2);
    for (const button of retries) await userEvent.setup().click(button);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenLastCalledWith(
      "quality",
      attemptId,
      screen.getByRole("heading", { level: 2 }),
    );
  });

  it("renders Not reached for pending steps, names the blocking review, and offers Retry", async () => {
    const run = blockedRun();
    expect(run.status).toBe("blocked");
    const onRetry = vi.fn<Retry>();
    detail(run, onRetry);
    const node = screen.getByRole("button", { name: /^adjudicate, Not reached/ });
    expect(within(node).getByText("Not reached").className).toContain("run-status-not-reached");
    const banner = screen.getByRole("region", { name: "Test quality blocked the run" });
    expect(within(banner).getByText(/Cannot run yarn test: shell refused\./)).toBeTruthy();
    await userEvent
      .setup()
      .click(within(banner).getByRole("button", { name: "Retry Test quality" }));
    const title = screen.getByRole("heading", { level: 2 });
    expect(onRetry).toHaveBeenCalledWith(
      "quality",
      run.steps.find((item) => item.stepId === "quality")?.attempts.at(-1)?.id,
      title,
    );
    // The banner unmounts once the run resumes, so focus moves to the run title, which stays.
    expect(document.activeElement).toBe(title);
  });

  it("shows only the tracker banner for a failed issue lookup", () => {
    const loop = parseLoop({
      schemaVersion: 2,
      id: "flow",
      name: "Flow",
      version: 1,
      status: "published",
      steps: [step("build", "implementation")],
      dependencies: [],
      groups: [],
      joins: [],
      decisions: [],
      policy: { maxAttemptsPerStep: 2 },
    });
    let run = createRunRecord(
      createRunSnapshot(
        loop,
        { description: "", ticketId: "PROJ-1" },
        { provider: "mock", model: "default" },
      ),
    );
    run = startAttempt(run, "build");
    const attemptId = run.steps[0]?.attempts[0]?.id ?? "";
    run = runRecordSchema.parse({
      ...finishAttempt(run, "build", "failed"),
      status: "failed",
      evidence: [
        {
          id: crypto.randomUUID(),
          runId: run.snapshot.id,
          stepId: "build",
          attemptId,
          createdAt: new Date().toISOString(),
          kind: "event",
          type: "lifecycle",
          title: "completed",
          detail: `${issueBlockedSentinel("PROJ-1")}.`,
          state: "failed",
          sequence: 0,
        },
      ],
    });
    detail(run);
    expect(
      screen.getByRole("region", { name: "Connect your issue tracker to continue" }),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: /failed$|blocked the run$/ })).toBeNull();
  });
});
