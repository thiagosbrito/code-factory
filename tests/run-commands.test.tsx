// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import { useFactoryRuns } from "../src/ui/features/runs/useFactoryRuns.js";
import { trustState } from "./fixtures/trust.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#");
});

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

/** A runtime with one trusted project and one run; `post` decides how POSTs to a run behave. */
const stubRuntime = (post: (path: string, body: unknown) => Promise<unknown>) => {
  const posts: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        const body: unknown = options.body ? JSON.parse(String(options.body)) : undefined;
        posts.push({ path, body });
        return { ok: true, json: async () => post(path, body) };
      }
      const body =
        path === "/api/loops/published"
          ? { loops: [] }
          : path === "/api/runs"
            ? { runs: [run] }
            : path === "/api/tracker"
              ? { configured: false }
              : path === "/api/project"
                ? { project: null, path: "/work", revision: null, trust: trustState() }
                : { run };
      return { ok: true, json: async () => body };
    }),
  );
  return posts;
};

const loadRuns = async () => {
  const view = renderHook(() => useFactoryRuns(false));
  await waitFor(() => expect(view.result.current.runs).toHaveLength(1));
  return view;
};

it("names the lost action when the connection drops during cancel, and keeps the run", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      if (options?.method === "POST") throw new TypeError("Network lost");
      const body =
        path === "/api/loops/published"
          ? { loops: [] }
          : path === "/api/runs"
            ? { runs: [run] }
            : { configured: false };
      return { ok: true, json: async () => body };
    }),
  );
  const view = await loadRuns();
  await act(async () => view.result.current.cancel(run.snapshot.id));
  expect(view.result.current.connected).toBe(false);
  expect(view.result.current.notice).toMatch(/Cancellation state is unknown/);
  expect(view.result.current.runs[0]?.status).toBe("pending");
});

it("shows the runtime's own message, without dropping the connection, when retry is refused", async () => {
  const posts = stubRuntime(async () => {
    throw new Error("unused");
  });
  const fetchMock = vi.mocked(fetch);
  const original = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (path, options) => {
    if (options?.method === "POST") {
      posts.push({ path: String(path), body: JSON.parse(String(options.body)) });
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: "Step is not retryable." }),
      } as Response;
    }
    if (!original) throw new Error("missing stub");
    return original(path, options);
  });
  const view = await loadRuns();
  await act(async () => view.result.current.retry(run.snapshot.id, "build", "attempt-1", null));
  expect(posts).toEqual([
    {
      path: `/api/runs/${run.snapshot.id}/retry`,
      body: { stepId: "build", attemptId: "attempt-1" },
    },
  ]);
  expect(view.result.current.notice).toBe("Step is not retryable.");
  expect(view.result.current.connected).toBe(true);
  expect(view.result.current.executingRunId).toBeNull();
});

it("sends guidance as a JSON body and folds the returned run in", async () => {
  const updated = { ...run, revision: run.revision + 1, status: "waiting" as const };
  const posts = stubRuntime(async () => ({ run: updated }));
  const view = await loadRuns();
  await act(async () =>
    view.result.current.sendGuidance(run.snapshot.id, {
      stepId: "build",
      attemptId: "attempt-1",
      message: "Use the existing helper",
    }),
  );
  expect(posts).toEqual([
    {
      path: `/api/runs/${run.snapshot.id}/guidance`,
      body: { stepId: "build", attemptId: "attempt-1", message: "Use the existing helper" },
    },
  ]);
  await waitFor(() => expect(view.result.current.runs[0]?.status).toBe("waiting"));
});
