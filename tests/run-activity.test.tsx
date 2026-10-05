// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot, runRecordSchema } from "../src/domain/run.js";
import { claimStep } from "../src/domain/scheduler.js";
import { RunActivity } from "../src/ui/RunActivity.js";

afterEach(cleanup);

it("filters actual attempt events, expands real tool output, and shows disconnected state", async () => {
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
  const claimed = claimStep(
    createRunRecord(
      createRunSnapshot(loop, { description: "Task" }, { provider: "mock", model: "default" }),
    ),
    "build",
    "candidate",
    "input",
  );
  const attemptId = claimed.steps[0]!.attempts[0]!.id;
  const event = (sequence: number, type: "message" | "tool", title: string, detail: string) => ({
    id: crypto.randomUUID(),
    runId: claimed.snapshot.id,
    stepId: "build",
    attemptId,
    createdAt: new Date().toISOString(),
    kind: "event" as const,
    type,
    title,
    detail,
    sequence,
  });
  const run = runRecordSchema.parse({
    ...claimed,
    evidence: [
      event(0, "message", "message", "Working on the task"),
      event(1, "tool", "pnpm check", "3 tests passed"),
    ],
  });
  render(<RunActivity run={run} connected={false} />);
  expect(screen.getByText(/Disconnected · execution state unknown/)).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Tools" }));
  expect(screen.queryByText("Working on the task")).toBeNull();
  expect(screen.getByText("pnpm check")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Show details" }));
  expect(screen.getByText("3 tests passed")).toBeTruthy();
  await user.type(screen.getByRole("textbox", { name: "Search activity" }), "other");
  expect(screen.getByText(/No matching activity/)).toBeTruthy();
});
