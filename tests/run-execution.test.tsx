// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import { RunExecution } from "../src/ui/RunExecution.js";

afterEach(cleanup);

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
      run={{ ...run, status: "rejected" }}
      executing={false}
      onExecute={onExecute}
      onCancel={onCancel}
    />,
  );
  expect(screen.queryByRole("button", { name: "Execute run" })).toBeNull();
  expect(screen.getByText(/final permitted candidate/)).toBeTruthy();
});
