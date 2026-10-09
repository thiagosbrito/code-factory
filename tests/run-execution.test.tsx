// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import { claimStep } from "../src/domain/scheduler.js";
import { RunExecution } from "../src/ui/features/runs/RunExecution.js";
import { useFactoryRuns } from "../src/ui/features/runs/useFactoryRuns.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#");
});

it("starts a pending run and shows persisted step and rejection state", async () => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps: [{ id: "build", name: "Build", kind: "agent", role: "builder", instruction: "Build" }],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: {},
  });
  const run = createRunRecord(
    createRunSnapshot(loop, { description: "Task" }, { provider: "mock", model: "default" }),
  );
  const onExecute = vi.fn<() => void>();
  const onCancel = vi.fn<() => void>();
  const view = render(
    <RunExecution run={run} executing={false} onExecute={onExecute} onCancel={onCancel} />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Execute run" }));
  expect(onExecute).toHaveBeenCalledOnce();
  expect(screen.getByText(/0 attempts/)).toBeTruthy();
  view.rerender(<RunExecution run={run} executing onExecute={onExecute} onCancel={onCancel} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Cancel run" }));
  expect(onCancel).toHaveBeenCalledOnce();
  view.rerender(
    <RunExecution
      run={{ ...run, status: "running" }}
      executing={false}
      onExecute={onExecute}
      onCancel={onCancel}
    />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Cancel run" }));
  expect(onCancel).toHaveBeenCalledTimes(2);
  view.rerender(
    <RunExecution
      run={{ ...run, status: "rejected" }}
      executing={false}
      onExecute={onExecute}
      onCancel={onCancel}
    />,
  );
  expect(screen.queryByRole("button", { name: "Execute run" })).toBeNull();
  expect(screen.getByText(/final permitted candidate/)).toBeTruthy();
});

it("resumes polling a persisted running run after reopening it", async () => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps: [{ id: "build", name: "Build", kind: "agent", role: "builder", instruction: "Build" }],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: {},
  });
  const pending = createRunRecord(
    createRunSnapshot(loop, { description: "Task" }, { provider: "mock", model: "default" }),
  );
  const running = claimStep(pending, "build", "candidate", "input");
  window.history.replaceState(null, "", `#runs/${running.snapshot.id}`);
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      paths.push(path);
      const body =
        path === "/api/loops/published"
          ? { loops: [] }
          : path === "/api/runs"
            ? { runs: [running] }
            : path === "/api/tracker"
              ? { configured: false }
              : { run: running };
      return { ok: true, json: async () => body };
    }),
  );
  const view = renderHook(() => useFactoryRuns(false));
  await waitFor(() => expect(view.result.current.selectedRun?.status).toBe("running"));
  await waitFor(() => expect(paths).toContain(`/api/runs/${running.snapshot.id}`), {
    timeout: 2500,
  });
  view.unmount();
});

it("keeps execution unknown when the launch response is lost", async () => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps: [{ id: "build", name: "Build", kind: "agent", role: "builder", instruction: "Build" }],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: {},
  });
  const pending = createRunRecord(
    createRunSnapshot(loop, { description: "Task" }, { provider: "mock", model: "default" }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      if (options?.method === "POST") throw new TypeError("Network lost");
      return {
        ok: true,
        json: async () =>
          path === "/api/loops/published"
            ? { loops: [] }
            : path === "/api/runs"
              ? { runs: [pending] }
              : { configured: false },
      };
    }),
  );
  const view = renderHook(() => useFactoryRuns(false));
  await waitFor(() => expect(view.result.current.runs).toHaveLength(1));
  await act(async () => view.result.current.execute(pending.snapshot.id));
  expect(view.result.current.connected).toBe(false);
  expect(view.result.current.notice).toMatch(/Execution state is unknown/);
  expect(view.result.current.runs[0]?.status).toBe("pending");
});
