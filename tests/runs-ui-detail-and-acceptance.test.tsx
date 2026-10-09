// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type RunWorkspace } from "../src/domain/run-branch.js";
import { afterEach, expect, it, vi } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { claimStep, completeStep } from "../src/domain/scheduler.js";
import {
  createRunRecord,
  createRunSnapshot,
  runRecordSchema,
  type RunRecord,
} from "../src/domain/run.js";
import { RunDetail } from "../src/ui/features/runs/RunDetail.js";
import {
  type EvidenceSummary,
  acceptEvidence,
  summarizeEvidence,
} from "../src/domain/acceptance.js";
import { makeRun } from "./support/runs-ui.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#");
});

/** A failed ticket-only run whose latest attempt reported the given lookup output. */
const blockedTicketRun = (detail: string, maxAttemptsPerStep = 3) => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "issue-flow",
    name: "Issue flow",
    version: 1,
    status: "published",
    steps: [{ id: "build", name: "Build", kind: "agent", role: "builder", instruction: "Build" }],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep },
  });
  const initial = createRunRecord(
    createRunSnapshot(
      loop,
      { description: "", ticketId: "PROJ-123" },
      { provider: "codex", model: "agent-default" },
    ),
  );
  const failed = completeStep(claimStep(initial, "build", "candidate", "inputs"), "build", {
    status: "failed",
  });
  const attemptId = failed.steps[0]?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing issue lookup attempt");
  const run = runRecordSchema.parse({
    ...failed,
    evidence: [
      {
        id: crypto.randomUUID(),
        runId: failed.snapshot.id,
        stepId: "build",
        attemptId,
        createdAt: new Date().toISOString(),
        kind: "event",
        type: "lifecycle",
        title: "completed",
        detail,
        state: "succeeded",
        sequence: 0,
      },
    ],
  });
  return { run, attemptId };
};

const renderDetail = (
  run: RunRecord,
  onRetry: (stepId: string, attemptId: string) => void = () => {},
) =>
  render(
    <RunDetail
      run={run}
      summary={null}
      accepting={false}
      onAccept={() => {}}
      connected
      executing={false}
      onExecute={() => {}}
      onCancel={() => {}}
      onRetry={onRetry}
      onBack={() => {}}
    />,
  );

it("returns focus to the detail icon when a dialog closes, and to the evidence icon after a hand-off", async () => {
  const user = userEvent.setup();
  renderDetail(makeRun());
  const description = screen.getByRole("button", { name: "Description" });
  await user.click(description);
  await user.keyboard("{Escape}");
  await vi.waitFor(() => expect(document.activeElement).toBe(description));
  const evidence = screen.getByRole("button", { name: "Final evidence summary" });
  await user.click(evidence);
  await user.click(screen.getByRole("button", { name: /Changed files/ }));
  const inspector = screen.getByLabelText("Run inspector");
  expect(screen.queryByRole("dialog", { name: "Final evidence summary" })).toBeNull();
  // The closing dialog must not pull focus back to its icon while the inspector is open.
  await vi.waitFor(() => expect(inspector.contains(document.activeElement)).toBe(true));
  await user.click(screen.getByRole("button", { name: "Close inspector" }));
  await vi.waitFor(() => expect(document.activeElement).toBe(evidence));
});

it.each([
  ["provider-neutral", "BLOCKED: Issue PROJ-123 could not be retrieved; MCP unavailable"],
  ["legacy Jira", "BLOCKED: Jira issue PROJ-123 could not be retrieved; MCP unavailable"],
])("offers an issue tracker connection retry for the %s sentinel", async (_label, detail) => {
  const { run, attemptId } = blockedTicketRun(detail);
  const onRetry = vi.fn<(stepId: string, attemptId: string) => void>();
  renderDetail(run, onRetry);
  const banner = screen.getByRole("region", { name: "Connect your issue tracker to continue" });
  expect(banner.textContent).toContain(
    "Connect its issue tracker MCP (for example Jira or Linear) in your Codex settings",
  );
  // The banner is not an alert; the problem is announced through a separate live message.
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen
      .getAllByRole("status")
      .some(
        (item) =>
          item.textContent ===
          "Issue PROJ-123 could not be retrieved. Connect your issue tracker to continue.",
      ),
  ).toBe(true);
  expect(screen.getByText("Issue tracker connection needed")).toBeTruthy();
  await userEvent.click(within(banner).getByRole("button", { name: "Retry after connecting" }));
  expect(onRetry).toHaveBeenCalledWith("build", attemptId);
});

it("disables the connection retry once the step's attempt budget is spent", () => {
  const { run } = blockedTicketRun("BLOCKED: Issue PROJ-123 could not be retrieved", 1);
  renderDetail(run);
  const banner = screen.getByRole("region", { name: "Connect your issue tracker to continue" });
  expect(
    within(banner).getByRole("button", { name: "Retry after connecting" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(banner.textContent).toContain("This step has reached its retry limit.");
});

it("shows no connection banner for an unrelated failure", () => {
  const { run } = blockedTicketRun("Build failed: tests are red");
  renderDetail(run);
  expect(screen.queryByRole("region", { name: /issue tracker/ })).toBeNull();
  expect(
    screen
      .getAllByRole("status")
      .some((item) => item.textContent?.includes("could not be retrieved")),
  ).toBe(false);
});

it("shows validation separately from human acceptance and records an explicit click", async () => {
  const onAccept = vi.fn<() => void>();
  const summary: EvidenceSummary = {
    validation: "passed",
    acceptance: "pending",
    requirements: [
      {
        stepId: "review",
        name: "Review",
        state: "met",
        reason: "Current receipt",
        receiptId: "r1",
      },
    ],
    findings: ["Checked edge case"],
    gaps: [],
    files: [],
    artifacts: [],
    signature: "current",
  };
  const view = render(
    <RunDetail
      run={makeRun()}
      summary={summary}
      accepting={false}
      onAccept={onAccept}
      connected
      executing={false}
      onExecute={vi.fn<() => void>()}
      onCancel={vi.fn<() => void>()}
      onBack={vi.fn<() => void>()}
    />,
  );
  // The header keeps validation, acceptance and the Accept action visible over the canvas.
  expect(screen.getByText(/Local validation:/).textContent).toContain("Human acceptance: pending");
  await userEvent.click(screen.getByRole("button", { name: "Accept evidence" }));
  expect(onAccept).toHaveBeenCalledOnce();
  // Requirements and findings live in the evidence dialog behind its icon.
  expect(screen.queryByText("Checked edge case")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Final evidence summary" }));
  const dialog = screen.getByRole("dialog", { name: "Final evidence summary" });
  expect(within(dialog).getByText("Checked edge case")).toBeTruthy();
  await userEvent.click(within(dialog).getByRole("button", { name: "Accept evidence" }));
  expect(onAccept).toHaveBeenCalledTimes(2);
  view.rerender(
    <RunDetail
      run={makeRun()}
      summary={{ ...summary, acceptance: "invalidated", validation: "incomplete" }}
      accepting={false}
      onAccept={onAccept}
      connected
      executing={false}
      onExecute={vi.fn<() => void>()}
      onCancel={vi.fn<() => void>()}
      onBack={vi.fn<() => void>()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Accept evidence" })).toBeNull();
  expect(screen.getByText(/Earlier acceptance remains/)).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Final evidence summary" }),
  );
});

it("keeps the canvas in front: details open from icons and run controls float over the graph", async () => {
  const onExecute = vi.fn<() => void>();
  const onCancel = vi.fn<() => void>();
  const workspace: RunWorkspace = {
    kind: "project",
    path: "/work/repo",
    branch: "BMAP-9999",
    state: "present",
    dirty: false,
    removalBlocked: null,
    commits: [],
    promotion: null,
    defaultBranchName: "",
    setupConfigured: false,
    checkout: {
      current: "BMAP-9999",
      onRunBranch: true,
      previousBranch: "main",
      previousRevision: "a".repeat(40),
      returnBlocker: "Finish or cancel the run before switching back to main.",
    },
  };
  const run: RunRecord = { ...makeRun(), status: "pending" };
  render(
    <RunDetail
      run={run}
      summary={null}
      accepting={false}
      onAccept={vi.fn<() => void>()}
      connected
      executing={false}
      onExecute={onExecute}
      onCancel={onCancel}
      onBack={vi.fn<() => void>()}
      workspace={workspace}
    />,
  );
  const user = userEvent.setup();
  // The description, branch panel and evidence are not on the page until asked for.
  expect(screen.queryByText(run.snapshot.task.description)).toBeNull();
  expect(screen.queryByRole("region", { name: "Run branch" })).toBeNull();
  const graph = screen.getByRole("region", { name: "Execution graph" });
  await user.click(within(graph).getByRole("button", { name: "Execute run" }));
  await user.click(within(graph).getByRole("button", { name: "Cancel run" }));
  expect(onExecute).toHaveBeenCalledOnce();
  expect(onCancel).toHaveBeenCalledOnce();
  await user.click(within(graph).getByRole("button", { name: "Description" }));
  expect(
    within(screen.getByRole("dialog", { name: "Description" })).getByText(
      run.snapshot.task.description,
    ),
  ).toBeTruthy();
  await user.keyboard("{Escape}");
  await user.click(within(graph).getByRole("button", { name: "Run branch" }));
  const branch = within(screen.getByRole("dialog", { name: "Run branch" }));
  expect(branch.getByText("BMAP-9999")).toBeTruthy();
  expect(branch.getByRole("button", { name: "Back to main" }).hasAttribute("disabled")).toBe(true);
});

it("keeps a prior acceptance receipt visible but marks it invalidated after source changes", async () => {
  const oldCandidate = "candidate-before-source-change";
  const loop = parseLoop({
    schemaVersion: 2,
    id: "validation",
    name: "Validation",
    version: 1,
    status: "published",
    steps: [
      {
        id: "check",
        name: "Build check",
        kind: "check",
        stage: "review",
        role: "reviewer",
        instruction: "Run check",
      },
    ],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: {},
  });
  let run = claimStep(
    createRunRecord(
      createRunSnapshot(loop, { description: "Current task" }, { provider: "mock", model: "m" }),
    ),
    "check",
    oldCandidate,
    "task-input",
  );
  run = completeStep(run, "check", { status: "succeeded", outcome: "passed" });
  const attempt = run.steps[0]?.attempts[0];
  if (!attempt) throw new Error("Missing check attempt");
  run = runRecordSchema.parse({
    ...run,
    status: "succeeded",
    evidence: [
      {
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "check",
        attemptId: attempt.id,
        createdAt: new Date().toISOString(),
        kind: "check",
        command: "pnpm check",
        outcome: "passed",
        exitCode: 0,
        summary: "Passed",
        inputHash: "task-input",
        provenance: {
          source: "check",
          baselineId: run.snapshot.baseline.id,
          candidateId: oldCandidate,
          inputReceiptIds: [],
        },
        freshness: { state: "current", checkedAgainstCandidateId: oldCandidate },
      },
    ],
  });
  run = acceptEvidence(run, oldCandidate);
  expect(summarizeEvidence(run, oldCandidate).acceptance).toBe("accepted");
  const summary = summarizeEvidence(run, "candidate-after-source-change");
  expect(summary.acceptance).toBe("invalidated");
  render(
    <RunDetail
      run={run}
      summary={summary}
      accepting={false}
      onAccept={vi.fn<() => void>()}
      connected
      executing={false}
      onExecute={vi.fn<() => void>()}
      onCancel={vi.fn<() => void>()}
      onBack={vi.fn<() => void>()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Inspect run evidence" }));
  await userEvent.click(screen.getByRole("tab", { name: "Details" }));
  const provenanceSection = screen.getByText("Evidence provenance").parentElement;
  expect(provenanceSection?.textContent).toContain(
    "acceptance · human · invalidated · current validation inputs changed",
  );
  expect(provenanceSection?.textContent).toContain(oldCandidate);
  expect(provenanceSection?.textContent).not.toContain("acceptance · human · current");
});
