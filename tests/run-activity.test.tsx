// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot, runRecordSchema } from "../src/domain/run.js";
import { claimStep } from "../src/domain/scheduler.js";
import { RunActivity } from "../src/ui/RunActivity.js";
import { RunInspectorActivity } from "../src/ui/RunInspectorActivity.js";
import { RunsList } from "../src/ui/RunsList.js";

afterEach(cleanup);

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
it("filters actual attempt events, expands real tool output, and shows disconnected state", async () => {
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

it("renders streamed message chunks as one entry that grows in place", () => {
  const run = runRecordSchema.parse({
    ...claimed,
    evidence: [
      event(0, "message", "message", "I'll start"),
      event(1, "message", "message", " by looking at the exist"),
    ],
  });
  const { rerender } = render(<RunActivity run={run} connected />);
  const list = screen.getByRole("list");
  expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  const entry = within(list).getByRole("listitem");
  expect(entry.textContent).toContain("I'll start by looking at the exist");
  // The type label appears once; the identical "message" title is not repeated.
  expect(within(entry).getAllByText(/^message$/i)).toHaveLength(1);
  expect(entry.querySelectorAll("time")).toHaveLength(1);
  rerender(
    <RunActivity
      run={runRecordSchema.parse({
        ...run,
        evidence: [...run.evidence, event(2, "message", "message", "ing TagMapping feature.")],
      })}
      connected
    />,
  );
  expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  // Same node: the live region sees a text change, not a new addition to announce.
  expect(within(list).getByRole("listitem")).toBe(entry);
  expect(entry.textContent).toContain("I'll start by looking at the existing TagMapping feature.");
  expect(list.getAttribute("aria-relevant")).toBe("additions");
});

it("shows streamed chunks as one inspector entry and one run list preview", () => {
  const run = runRecordSchema.parse({
    ...claimed,
    evidence: [
      event(0, "message", "message", "Reading "),
      event(1, "message", "message", "the code."),
    ],
  });
  const scope = { kind: "step" as const, stepId: "build", attemptId };
  const { rerender } = render(<RunInspectorActivity run={run} scope={scope} connected />);
  const list = screen.getByRole("list", { name: "Activity events" });
  const entry = within(list).getByRole("listitem");
  expect(entry.textContent).toContain("Reading the code.");
  expect(within(entry).getAllByText(/^message$/i)).toHaveLength(1);
  const grown = runRecordSchema.parse({
    ...run,
    evidence: [
      ...run.evidence,
      event(2, "message", "message", " Then tests."),
      event(3, "tool", "pnpm test", "ok"),
      event(4, "message", "message", "Done."),
    ],
  });
  rerender(<RunInspectorActivity run={grown} scope={scope} connected />);
  expect(
    within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    expect.stringContaining("Reading the code. Then tests."),
    expect.stringContaining("pnpm test"),
    expect.stringContaining("Done."),
  ]);
  // The tool and the new message are new entries; growth of the first message is not.
  expect(screen.getByRole("button", { name: "2 new events · Jump to latest" })).toBeTruthy();
  cleanup();
  render(<RunsList runs={[run]} onOpen={() => {}} />);
  expect(screen.getByText("Reading the code.")).toBeTruthy();
});

it("shows the agent's reply to guidance as a new inspector entry", () => {
  const at = (offset: number) => new Date(Date.parse("2026-10-08T09:29:55.000Z") + offset);
  const timed = (offset: number, ...args: Parameters<typeof event>) => ({
    ...event(...args),
    createdAt: at(offset).toISOString(),
  });
  const run = runRecordSchema.parse({
    ...claimed,
    evidence: [
      timed(0, 0, "message", "message", "Reading "),
      timed(10, 1, "message", "message", "the code."),
    ],
  });
  const scope = { kind: "step" as const, stepId: "build", attemptId };
  const { rerender } = render(<RunInspectorActivity run={run} scope={scope} connected />);
  const list = screen.getByRole("list", { name: "Activity events" });
  const replied = runRecordSchema.parse({
    ...run,
    evidence: [
      ...run.evidence,
      timed(30, 2, "message", "message", "Understood, switching."),
      {
        id: crypto.randomUUID(),
        runId: claimed.snapshot.id,
        stepId: "build",
        attemptId,
        createdAt: at(20).toISOString(),
        kind: "guidance",
        messageId: crypto.randomUUID(),
        message: "Use the helper",
        state: "queued",
      },
    ],
  });
  rerender(<RunInspectorActivity run={replied} scope={scope} connected />);
  expect(
    within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    expect.stringContaining("Reading the code."),
    expect.stringContaining("Understood, switching."),
  ]);
  expect(screen.getByRole("button", { name: "1 new events · Jump to latest" })).toBeTruthy();
});
