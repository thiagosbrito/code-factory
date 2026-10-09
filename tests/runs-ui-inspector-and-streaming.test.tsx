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
import { RunDetail } from "../src/ui/features/runs/RunDetail.js";
import { RunInspector } from "../src/ui/features/runs/RunInspector.js";
import { type RunScope } from "../src/ui/features/runs/run-view-model.js";
import { useFactoryRuns } from "../src/ui/features/runs/useFactoryRuns.js";
import { makeRun } from "./support/runs-ui.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#");
});

it("wraps arrow-key navigation across the inspector tabs and moves focus with it", () => {
  render(
    <RunInspector
      run={makeRun()}
      scope={{ kind: "run" }}
      onScopeChange={vi.fn<(scope: RunScope) => void>()}
      onClose={vi.fn<() => void>()}
      connected
    />,
  );
  const first = screen.getByRole("tab", { name: "Activity" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowLeft" });
  const details = screen.getByRole("tab", { name: "Details" });
  expect(details.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(details);
  fireEvent.keyDown(details, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("true");
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
