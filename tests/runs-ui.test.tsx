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
import { createRunRecord, createRunSnapshot, startAttempt } from "../src/domain/run.js";
import { RunDetail } from "../src/ui/RunDetail.js";
import { RunInspector } from "../src/ui/RunInspector.js";
import type { RunScope } from "../src/ui/run-view-model.js";
import { useFactoryRuns } from "../src/ui/useFactoryRuns.js";
import { RunsList } from "../src/ui/RunsList.js";

const makeRun = () => {
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#");
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
  render(
    <RunDetail
      run={withEvidence}
      connected
      executing={false}
      onExecute={vi.fn<() => void>()}
      onCancel={vi.fn<() => void>()}
      onBack={vi.fn<() => void>()}
    />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: /Build, running/ }));
  await userEvent.setup().click(screen.getByRole("tab", { name: /^Files/ }));
  expect(screen.getByText("src/build.ts")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("tab", { name: /^Artifacts/ }));
  expect(screen.queryByText("review.md")).toBeNull();
  await userEvent.setup().click(screen.getByRole("tab", { name: "Details" }));
  expect(screen.getByText(/Candidate candidate-1/)).toBeTruthy();
  expect(screen.getByText("plan")).toBeTruthy();
});
