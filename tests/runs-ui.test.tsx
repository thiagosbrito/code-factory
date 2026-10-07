// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { claimStep, completeStep } from "../src/domain/scheduler.js";
import {
  createRunRecord,
  createRunSnapshot,
  attachAttemptSession,
  setAttemptControlState,
  startAttempt,
  finishAttempt,
  runRecordSchema,
} from "../src/domain/run.js";
import type { RunRecord } from "../src/domain/run.js";
import { RunDetail } from "../src/ui/RunDetail.js";
import { RunInputPrompt } from "../src/ui/RunInputPrompt.js";
import { RunGraph } from "../src/ui/RunGraph.js";
import { RunInspector } from "../src/ui/RunInspector.js";
import { RunInspectorFiles } from "../src/ui/RunInspectorFiles.js";
import { RunInspectorArtifacts } from "../src/ui/RunInspectorArtifacts.js";
import { downloadBytes } from "../src/ui/inspection-api.js";
import { RunGuidance } from "../src/ui/RunGuidance.js";
import type { AgentConnection } from "../src/adapters/contract.js";
import type { RunScope } from "../src/ui/run-view-model.js";
import { useFactoryRuns } from "../src/ui/useFactoryRuns.js";
import { RunsList } from "../src/ui/RunsList.js";
import type { EvidenceSummary } from "../src/domain/acceptance.js";
import { acceptEvidence, summarizeEvidence } from "../src/domain/acceptance.js";

it("preserves a scoped guidance draft through disconnect and gates it on verified steering", async () => {
  const run = makeRun();
  const attemptId = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  const scope: RunScope = { kind: "step", stepId: "build", attemptId };
  const connection: AgentConnection = {
    provider: "mock",
    executable: null,
    installation: "built-in",
    authentication: "not-required",
    capabilities: {
      streaming: "supported",
      steering: "unknown",
      resume: "unsupported",
      pause: "unsupported",
      waitingInput: "unknown",
    },
  };
  const onSend = vi.fn<() => Promise<void>>(async () => undefined);
  const view = render(
    <RunGuidance run={run} scope={scope} connected={false} agents={[connection]} onSend={onSend} />,
  );
  await userEvent.type(
    screen.getByLabelText("Message for selected attempt"),
    "Check the edge case",
  );
  expect(
    (screen.getByRole("button", { name: "Queue guidance" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/Runtime disconnected/)).toBeTruthy();
  view.rerender(
    <RunGuidance run={run} scope={scope} connected agents={[connection]} onSend={onSend} />,
  );
  expect((screen.getByLabelText("Message for selected attempt") as HTMLTextAreaElement).value).toBe(
    "Check the edge case",
  );
  expect(
    (screen.getByRole("button", { name: "Queue guidance" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  view.rerender(
    <RunGuidance
      run={run}
      scope={scope}
      connected
      agents={[
        { ...connection, capabilities: { ...connection.capabilities, steering: "supported" } },
      ]}
      onSend={onSend}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Queue guidance" }));
  expect(onSend).toHaveBeenCalledWith({
    stepId: "build",
    attemptId,
    message: "Check the edge case",
  });
});

const makeRun = (): RunRecord => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 2,
    status: "published",
    steps: [
      {
        id: "plan",
        name: "Plan",
        kind: "agent",
        role: "planner",
        instruction: "Plan the work",
        expectedOutputs: ["plan.md"],
        position: { x: 40, y: 70 },
      },
      {
        id: "build",
        name: "Build",
        kind: "agent",
        role: "builder",
        instruction: "Build the work",
        position: { x: 340, y: 20 },
        groupId: "parallel",
      },
      {
        id: "review",
        name: "Review",
        kind: "agent",
        role: "reviewer",
        instruction: "Review the work",
        position: { x: 340, y: 180 },
        groupId: "parallel",
      },
    ],
    dependencies: [
      { from: "plan", to: "build" },
      { from: "plan", to: "review" },
    ],
    groups: [
      { id: "parallel", name: "Parallel work", kind: "parallel", stepIds: ["build", "review"] },
    ],
    joins: [],
    decisions: [],
    policy: {},
  });
  let run = createRunRecord(
    createRunSnapshot(
      loop,
      {
        description: "Build a feature",
        ticket: { id: "T-1", title: "First task", summary: "Task", attachments: [] },
      },
      { provider: "mock", model: "model-a" },
    ),
  );
  run = startAttempt(run, "build");
  run = startAttempt(run, "review");
  const buildAttempt = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  const reviewAttempt = run.steps.find((step) => step.stepId === "review")?.attempts[0]?.id;
  if (!buildAttempt || !reviewAttempt) throw new Error("Missing attempts");
  return {
    ...run,
    evidence: [
      {
        kind: "event" as const,
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "build",
        attemptId: buildAttempt,
        createdAt: new Date().toISOString(),
        type: "message" as const,
        title: "Build message",
        sequence: 0,
      },
      {
        kind: "event" as const,
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "review",
        attemptId: reviewAttempt,
        createdAt: new Date().toISOString(),
        type: "message" as const,
        title: "Review message",
        sequence: 1,
      },
    ],
  };
};

it("submits answers only for a connected provider with native input support", async () => {
  let run = makeRun();
  const attemptId = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  run = attachAttemptSession(run, "build", "thread-1", "turn-1");
  run = setAttemptControlState(run, "build", attemptId, "waiting-input");
  const requestEvidenceId = crypto.randomUUID();
  run = runRecordSchema.parse({
    ...run,
    evidence: [
      ...run.evidence,
      {
        kind: "input-request",
        id: requestEvidenceId,
        runId: run.snapshot.id,
        stepId: "build",
        attemptId,
        createdAt: new Date().toISOString(),
        sessionId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        requestId: 0,
        questions: [{ id: "choice", header: "Choice", question: "Choose", options: [] }],
        isBlocking: true,
        autoResolutionMs: null,
      },
    ],
  });
  const agents: AgentConnection[] = [
    {
      provider: "mock",
      executable: null,
      installation: "built-in",
      authentication: "not-required",
      capabilities: {
        streaming: "supported",
        steering: "unsupported",
        resume: "unsupported",
        pause: "unsupported",
        waitingInput: "supported",
      },
    },
  ];
  const onReply = vi.fn<() => Promise<void>>(async () => undefined);
  const view = render(
    <RunInputPrompt run={run} agents={agents} connected={false} onReply={onReply} />,
  );
  expect((screen.getByRole("button", { name: "Send answers" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  view.rerender(<RunInputPrompt run={run} agents={agents} connected onReply={onReply} />);
  await userEvent.type(screen.getByLabelText("Choice"), "yes");
  await userEvent.click(screen.getByRole("button", { name: "Send answers" }));
  expect(onReply).toHaveBeenCalledWith({
    stepId: "build",
    attemptId,
    requestEvidenceId,
    answers: { choice: { answers: ["yes"] } },
  });
  const sending = runRecordSchema.parse({
    ...run,
    evidence: [
      ...run.evidence,
      {
        kind: "input-reply",
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "build",
        attemptId,
        createdAt: new Date().toISOString(),
        requestEvidenceId,
        answers: { choice: { answers: ["yes"] } },
        state: "sending",
      },
    ],
  });
  view.rerender(<RunInputPrompt run={sending} agents={agents} connected onReply={onReply} />);
  expect(screen.getByRole("status").textContent).toContain("Reply delivery is unconfirmed");
  expect(screen.queryByRole("button", { name: "Send answers" })).toBeNull();
});

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
  expect(screen.getByText(/Local validation:/).textContent).toContain("Human acceptance: pending");
  expect(screen.getByText("Checked edge case")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Accept evidence" }));
  expect(onAccept).toHaveBeenCalledOnce();
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

it("restores focus and supports keyboard tabs, resize, and explicit follow live", async () => {
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
  const node = screen.getByRole("button", { name: /Build, running/ });
  node.focus();
  await userEvent.setup().keyboard("{Enter}");
  const inspector = screen.getByLabelText("Run inspector");
  expect(within(inspector).getByRole("button", { name: "Close inspector" })).toBeTruthy();
  const activity = within(inspector).getByRole("tab", { name: "Activity" });
  activity.focus();
  fireEvent.keyDown(activity, { key: "ArrowRight" });
  expect(
    within(inspector)
      .getByRole("tab", { name: /^Files/ })
      .getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.keyDown(inspector, { key: "Escape" });
  await vi.waitFor(() => expect(document.activeElement).toBe(node));
  await userEvent.setup().click(node);
  expect(
    within(screen.getByLabelText("Run inspector")).getByRole("checkbox", { name: "Follow live" }),
  ).toBeTruthy();
});

it("keeps activity search, filter, and historical scroll through updates and scope changes", async () => {
  const run = makeRun();
  const attemptId = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  const scope = { kind: "step" as const, stepId: "build", attemptId };
  const onScopeChange = vi.fn<(nextScope: RunScope) => void>();
  const { rerender } = render(
    <RunInspector
      run={run}
      scope={scope}
      onScopeChange={onScopeChange}
      onClose={vi.fn<() => void>()}
      connected
    />,
  );
  const search = screen.getByRole("textbox", { name: "Search activity" });
  await userEvent.setup().type(search, "Build");
  await userEvent.setup().click(screen.getByRole("button", { name: "Messages" }));
  const list = screen.getByRole("list", { name: "Activity events" });
  list.scrollTop = 45;
  fireEvent.scroll(list);
  const updated = {
    ...run,
    evidence: [
      ...run.evidence,
      {
        kind: "event" as const,
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "build",
        attemptId,
        createdAt: new Date().toISOString(),
        type: "message" as const,
        title: "Build followup",
        sequence: 2,
      },
    ],
  };
  rerender(
    <RunInspector
      run={updated}
      scope={scope}
      onScopeChange={onScopeChange}
      onClose={vi.fn<() => void>()}
      connected={false}
    />,
  );
  expect(list.scrollTop).toBe(45);
  expect(screen.getByText("Build followup")).toBeTruthy();
  expect(screen.getByText(/Disconnected · execution state unknown/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /new events · Jump to latest/ })).toBeTruthy();
  rerender(
    <RunInspector
      run={updated}
      scope={{ kind: "run" }}
      onScopeChange={onScopeChange}
      onClose={vi.fn<() => void>()}
      connected
    />,
  );
  rerender(
    <RunInspector
      run={updated}
      scope={scope}
      onScopeChange={onScopeChange}
      onClose={vi.fn<() => void>()}
      connected
    />,
  );
  expect(screen.getByRole("textbox", { name: "Search activity" }).getAttribute("value")).toBe(
    "Build",
  );
  expect(screen.getByRole("button", { name: "Messages" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(list.scrollTop).toBe(45);
  expect(screen.getByText("Runtime reachable")).toBeTruthy();
});

it("repairs stale step and attempt scopes after a runtime snapshot changes", async () => {
  const run = makeRun();
  const onScopeChange =
    vi.fn<
      (scope: { kind: "run" } | { kind: "step"; stepId: string; attemptId: string | null }) => void
    >();
  const view = render(
    <RunInspector
      run={run}
      scope={{ kind: "step", stepId: "build", attemptId: crypto.randomUUID() }}
      onScopeChange={onScopeChange}
      onClose={vi.fn<() => void>()}
      connected
    />,
  );
  const currentAttempt = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  expect(onScopeChange).toHaveBeenCalledWith({
    kind: "step",
    stepId: "build",
    attemptId: currentAttempt,
  });
  view.rerender(
    <RunInspector
      run={run}
      scope={{ kind: "step", stepId: "removed", attemptId: null }}
      onScopeChange={onScopeChange}
      onClose={vi.fn<() => void>()}
      connected
    />,
  );
  expect(onScopeChange).toHaveBeenCalledWith({ kind: "run" });
});

it("merges streamed run state and events and reports reconnect independently of polling", async () => {
  const run = makeRun();
  window.history.replaceState(null, "", `#runs/${run.snapshot.id}`);
  class FakeEventSource {
    static current: FakeEventSource | null = null;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    listeners = new Map<string, (event: MessageEvent) => void>();
    constructor(readonly url: string) {
      FakeEventSource.current = this;
    }
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (typeof listener === "function")
        this.listeners.set(type, listener as (event: MessageEvent) => void);
    }
    close() {
      FakeEventSource.current = null;
    }
    emit(type: string, data: unknown) {
      this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path === "/api/loops/published"
              ? { loops: [] }
              : path === "/api/runs"
                ? { runs: [run] }
                : path === "/api/tracker"
                  ? { configured: false }
                  : { run },
          ),
          { status: 200 },
        ),
    ),
  );
  const view = renderHook(() => useFactoryRuns(false));
  await waitFor(() => expect(view.result.current.selectedRun?.snapshot.id).toBe(run.snapshot.id));
  const source = FakeEventSource.current;
  if (!source) throw new Error("Event stream did not open");
  expect(source.url).toBe(`/api/runs/${run.snapshot.id}/events`);
  act(() => {
    source.onopen?.();
  });
  expect(view.result.current.streamConnected).toBe(true);
  const event = {
    kind: "event" as const,
    id: crypto.randomUUID(),
    runId: run.snapshot.id,
    stepId: "review",
    attemptId: run.steps.find((step) => step.stepId === "review")?.attempts[0]?.id,
    createdAt: new Date().toISOString(),
    type: "message" as const,
    title: "New reviewer output",
    sequence: 2,
  };
  act(() => source.emit("execution-event", event));
  expect(
    view.result.current.selectedRun?.evidence.some(
      (item) => item.kind === "event" && item.title === "New reviewer output",
    ),
  ).toBe(true);
  act(() => source.emit("run-state", { ...run, revision: run.revision + 1, status: "waiting" }));
  expect(view.result.current.selectedRun?.status).toBe("waiting");
  act(() => {
    source.onerror?.();
  });
  expect(view.result.current.streamConnected).toBe(false);
  expect(view.result.current.connected).toBe(true);
  view.unmount();
});

it("keeps files and artifacts on their exact step attempt with recorded provenance", async () => {
  const run = makeRun();
  const buildAttempt = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  const reviewAttempt = run.steps.find((step) => step.stepId === "review")?.attempts[0]?.id;
  if (!buildAttempt || !reviewAttempt) throw new Error("Missing attempts");
  const provenance = {
    source: "agent" as const,
    baselineId: run.snapshot.baseline.id,
    candidateId: "candidate-1",
    inputReceiptIds: [],
  };
  const freshness = { state: "current" as const, checkedAgainstCandidateId: "candidate-1" };
  const withEvidence = {
    ...run,
    evidence: [
      ...run.evidence,
      {
        kind: "file" as const,
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "build",
        attemptId: buildAttempt,
        createdAt: new Date().toISOString(),
        path: "src/build.ts",
        change: "modified" as const,
        additions: 4,
        deletions: 1,
        diffDigest: "digest-1",
        provenance,
        freshness,
      },
      {
        kind: "artifact" as const,
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "review",
        attemptId: reviewAttempt,
        createdAt: new Date().toISOString(),
        name: "review.md",
        mediaType: "text/markdown",
        relativePath: "reports/review.md",
        digest: "digest-2",
        provenance,
        freshness,
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path.includes("/diff?")
              ? {
                  path: "src/build.ts",
                  diff: "diff --git a/src/build.ts b/src/build.ts\n",
                  change: { path: "src/build.ts", change: "modified", attribution: "recorded" },
                }
              : {
                  baselineRevision: "baseline",
                  files: [
                    {
                      path: "src/build.ts",
                      change: "modified",
                      attribution: "recorded",
                      stepId: "build",
                      attemptId: buildAttempt,
                    },
                  ],
                  preExisting: [],
                },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  render(
    <RunDetail
      run={withEvidence}
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
  await userEvent.setup().click(screen.getByRole("button", { name: /Build, running/ }));
  await userEvent.setup().click(screen.getByRole("tab", { name: /^Files/ }));
  expect(await screen.findAllByText("src/build.ts")).toHaveLength(2);
  await userEvent.setup().click(screen.getByRole("tab", { name: /^Artifacts/ }));
  expect(screen.queryByText("review.md")).toBeNull();
  await userEvent.setup().click(screen.getByRole("tab", { name: "Details" }));
  expect(screen.getByText(/Candidate candidate-1/)).toBeTruthy();
  expect(screen.getByText("plan")).toBeTruthy();
});

it("filters baseline changes by path and type, with keyboard operable file selection", async () => {
  const run = makeRun();
  const attemptId = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path.includes("/diff?")
              ? {
                  path: "src/task.ts",
                  diff: "+task",
                  change: { path: "src/task.ts", change: "modified", attribution: "recorded" },
                }
              : {
                  baselineRevision: "baseline",
                  files: [
                    {
                      path: "src/task.ts",
                      change: "modified",
                      attribution: "recorded",
                      stepId: "build",
                      attemptId,
                    },
                    { path: "notes.txt", change: "added", attribution: "uncertain" },
                  ],
                  preExisting: [
                    { path: "prior.txt", change: "modified", attribution: "uncertain" },
                  ],
                },
          ),
          { status: 200 },
        ),
    ),
  );
  const view = render(<RunInspectorFiles run={run} scope={{ kind: "run" }} />);
  expect(await screen.findByText("prior.txt")).toBeTruthy();
  expect(screen.getByText("notes.txt")).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Change type"), "modified");
  expect(screen.queryByText("notes.txt")).toBeNull();
  await userEvent.type(screen.getByLabelText("Search paths"), "missing");
  expect(screen.getByText("No paths match these filters.")).toBeTruthy();
  await userEvent.clear(screen.getByLabelText("Search paths"));
  const file = screen.getByRole("button", { name: /src\/task.ts/ });
  file.focus();
  await userEvent.keyboard("{Enter}");
  expect(file.getAttribute("aria-current")).toBe("true");
  view.rerender(
    <RunInspectorFiles run={run} scope={{ kind: "step", stepId: "review", attemptId: null }} />,
  );
  expect(screen.getByText(/No task changes are available for this scope/)).toBeTruthy();
});

it("shows artifact provenance and safe unsupported preview while retaining download bytes and name", async () => {
  const run = makeRun();
  const attemptId = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  const receipt = {
    kind: "artifact" as const,
    id: crypto.randomUUID(),
    runId: run.snapshot.id,
    stepId: "build",
    attemptId,
    createdAt: new Date().toISOString(),
    name: "report.bin",
    mediaType: "application/octet-stream",
    relativePath: "reports/report.bin",
    digest: "digest",
    provenance: {
      source: "agent" as const,
      baselineId: run.snapshot.baseline.id,
      candidateId: "candidate",
      inputReceiptIds: [],
    },
    freshness: { state: "superseded" as const, checkedAgainstCandidateId: "candidate" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ name: receipt.name, mediaType: receipt.mediaType, base64: "AAEC" }),
          { status: 200 },
        ),
    ),
  );
  const blob = vi.fn<(value: Blob) => string>(() => "blob:artifact");
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: blob,
    revokeObjectURL: vi.fn<(url: string) => void>(),
  });
  let downloaded = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloaded = this.download;
  });
  render(
    <RunInspectorArtifacts
      run={{ ...run, evidence: [...run.evidence, receipt] }}
      scope={{ kind: "step", stepId: "build", attemptId }}
    />,
  );
  expect(await screen.findByText(/Preview unavailable for this file type/)).toBeTruthy();
  expect(screen.getAllByText(/superseded/).length).toBeGreaterThan(0);
  expect(screen.getByText(`${run.snapshot.baseline.id} / candidate`)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Download" }));
  expect(downloaded).toBe("report.bin");
  expect(blob.mock.calls[0]?.[0].type).toBe("application/octet-stream");
  downloadBytes("nested/other.json", new Uint8Array([123, 125]), "application/json");
  expect(downloaded).toBe("other.json");
});

it("previews Markdown and JSON as safe content and selects receipts by keyboard", async () => {
  const run = makeRun();
  const attemptId = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  const common = {
    kind: "artifact" as const,
    runId: run.snapshot.id,
    stepId: "build",
    attemptId,
    createdAt: new Date().toISOString(),
    digest: "digest",
    provenance: {
      source: "agent" as const,
      baselineId: run.snapshot.baseline.id,
      candidateId: "candidate",
      inputReceiptIds: [],
    },
    freshness: { state: "current" as const },
  };
  const markdown = {
    ...common,
    id: crypto.randomUUID(),
    name: "notes.md",
    relativePath: "notes.md",
    mediaType: "text/markdown",
  };
  const json = {
    ...common,
    id: crypto.randomUUID(),
    name: "data.json",
    relativePath: "data.json",
    mediaType: "application/json",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      const isJson = path.includes(json.id);
      const content = isJson ? '{"ok":true}' : "# Title\n<script>alert(1)</script>";
      return new Response(
        JSON.stringify({
          name: isJson ? json.name : markdown.name,
          mediaType: isJson ? json.mediaType : markdown.mediaType,
          base64: btoa(content),
        }),
        { status: 200 },
      );
    }),
  );
  render(
    <RunInspectorArtifacts
      run={{ ...run, evidence: [...run.evidence, markdown, json] }}
      scope={{ kind: "run" }}
    />,
  );
  expect(await screen.findByRole("heading", { name: "Title" })).toBeTruthy();
  expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  const item = screen.getByRole("button", { name: /data.json/ });
  item.focus();
  await userEvent.keyboard("{Enter}");
  expect(item.getAttribute("aria-current")).toBe("true");
  expect(await screen.findByText(/"ok": true/)).toBeTruthy();
});

it("shows invalidated receipt freshness in Details while an independent sibling stays current", () => {
  const run = makeRun();
  const buildAttempt = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  const reviewAttempt = run.steps.find((step) => step.stepId === "review")?.attempts[0]?.id;
  if (!buildAttempt || !reviewAttempt) throw new Error("Missing attempts");
  const receipt = (stepId: string, attemptId: string) => ({
    kind: "artifact" as const,
    id: crypto.randomUUID(),
    runId: run.snapshot.id,
    stepId,
    attemptId,
    createdAt: new Date().toISOString(),
    name: `${stepId}.md`,
    mediaType: "text/markdown",
    relativePath: `reports/${stepId}.md`,
    digest: `${stepId}-digest`,
    provenance: {
      source: "agent" as const,
      baselineId: run.snapshot.baseline.id,
      candidateId: "candidate-1",
      inputReceiptIds: [],
    },
    freshness: { state: "current" as const, checkedAgainstCandidateId: "candidate-1" },
  });
  const withInvalidation = {
    ...run,
    evidence: [
      ...run.evidence,
      receipt("build", buildAttempt),
      receipt("review", reviewAttempt),
      {
        kind: "event" as const,
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "build",
        createdAt: new Date().toISOString(),
        type: "lifecycle" as const,
        title: "retry-invalidated",
        sequence: 2,
      },
    ],
  };
  const props = {
    run: withInvalidation,
    onScopeChange: vi.fn<(scope: RunScope) => void>(),
    onClose: vi.fn<() => void>(),
    connected: true,
    initialTab: "Details" as const,
  };
  const view = render(
    <RunInspector {...props} scope={{ kind: "step", stepId: "build", attemptId: buildAttempt }} />,
  );
  const provenanceSection = screen.getByText("Evidence provenance").parentElement;
  if (!provenanceSection) throw new Error("Missing provenance section");
  expect(within(provenanceSection).getByRole("listitem").textContent).toContain(
    "artifact · agent · superseded · needs revalidation",
  );
  view.rerender(
    <RunInspector
      {...props}
      scope={{ kind: "step", stepId: "review", attemptId: reviewAttempt }}
    />,
  );
  const siblingProvenance = screen.getByText("Evidence provenance").parentElement;
  if (!siblingProvenance) throw new Error("Missing sibling provenance section");
  expect(within(siblingProvenance).getByRole("listitem").textContent).toContain(
    "artifact · agent · current",
  );
});

it("confirms a failed step retry and restores focus after Escape and confirmation", async () => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "retry",
    name: "Retry",
    version: 1,
    status: "published",
    steps: [{ id: "build", name: "Build", kind: "agent", role: "builder", instruction: "Build" }],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 2 },
  });
  const pending = createRunRecord(
    createRunSnapshot(loop, { description: "Task" }, { provider: "mock", model: "default" }),
  );
  const failed = runRecordSchema.parse({
    ...finishAttempt(startAttempt(pending, "build"), "build", "failed"),
    status: "failed",
  });
  const attemptId = failed.steps[0]?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  const onRetry =
    vi.fn<(stepId: string, attemptId: string, focusTarget?: HTMLElement | null) => void>();
  render(
    <RunInspector
      run={failed}
      scope={{ kind: "step", stepId: "build", attemptId }}
      onScopeChange={vi.fn<(scope: RunScope) => void>()}
      onClose={vi.fn<() => void>()}
      connected
      onRetry={onRetry}
    />,
  );
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Retry…" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Retry Build?" });
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.tab();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(screen.getByText(/Create Attempt 2 for Build/)).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Start Attempt 2" }));
  // The inspector trigger is the focus target for a follow-up permission dialog.
  expect(onRetry).toHaveBeenCalledExactlyOnceWith("build", attemptId, trigger);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
