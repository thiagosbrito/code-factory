import { describe, expect, it } from "vitest";
import type { Evidence } from "../src/domain/evidence.js";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot, runRecordSchema } from "../src/domain/run.js";
import type { PublicEvent } from "../src/runtime/events.js";
import { activityPreview, coalesceActivity } from "../src/ui/features/runs/activity-entries.js";
import { claimStep } from "../src/domain/scheduler.js";
import { mergeRunEvent } from "../src/ui/features/runs/run-events.js";

const record = createRunRecord(
  createRunSnapshot(
    parseLoop({
      schemaVersion: 2,
      id: "flow",
      name: "Flow",
      version: 1,
      status: "published",
      steps: ["quality-review", "security-review"].map((id) => ({
        id,
        name: id,
        kind: "agent",
        role: "reviewer",
        instruction: "Review",
        stage: "review",
      })),
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
let clock = Date.parse("2026-10-08T09:29:55.000Z");
const event = (
  sequence: number,
  type: PublicEvent["type"],
  detail: string,
  attemptId = "attempt-1",
  stepId = "build",
): PublicEvent => ({
  id: `event-${sequence}`,
  runId: record.snapshot.id,
  stepId,
  attemptId,
  createdAt: new Date((clock += 100)).toISOString(),
  kind: "event",
  type,
  // The scheduler titles chunks with their type; tools and checks carry their own title.
  title: type === "tool" ? "pnpm test" : type,
  detail,
  sequence,
});
const summary = (events: PublicEvent[]) =>
  coalesceActivity(events).map((entry) => ({
    type: entry.type,
    attemptId: entry.attemptId,
    detail: entry.detail,
    sequence: entry.sequence,
    lastSequence: entry.lastSequence,
  }));

describe("coalesceActivity", () => {
  it("merges consecutive chunks of one attempt into one entry keeping the first chunk's identity", () => {
    const chunks = [
      event(0, "message", "I'll start"),
      event(1, "message", " by looking at the exist"),
      event(2, "message", "ing TagMapping feature."),
    ];
    const entries = coalesceActivity(chunks);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "event-0",
      createdAt: chunks[0]!.createdAt,
      title: "message",
      detail: "I'll start by looking at the existing TagMapping feature.",
      sequence: 0,
      lastSequence: 2,
    });
  });

  it("splits a message around a tool or error event of the same attempt", () => {
    expect(
      summary([
        event(0, "message", "Running "),
        event(1, "message", "tests."),
        event(2, "tool", "3 passed"),
        event(3, "message", "Tests "),
        event(4, "message", "pass."),
        event(5, "error", "Disk full"),
        event(6, "message", "Stopping."),
      ]).map((entry) => [entry.type, entry.detail]),
    ).toEqual([
      ["message", "Running tests."],
      ["tool", "3 passed"],
      ["message", "Tests pass."],
      ["error", "Disk full"],
      ["message", "Stopping."],
    ]);
  });

  it("splits on lifecycle events and never merges different attempts", () => {
    expect(
      summary([
        event(0, "message", "First try", "attempt-1"),
        event(1, "lifecycle", "", "attempt-1"),
        event(2, "message", "Second try", "attempt-2"),
        event(3, "message", " continues", "attempt-2"),
      ]).map((entry) => [entry.attemptId, entry.type, entry.detail]),
    ).toEqual([
      ["attempt-1", "message", "First try"],
      ["attempt-1", "lifecycle", ""],
      ["attempt-2", "message", "Second try continues"],
    ]);
    expect(
      coalesceActivity([event(0, "message", "A", "attempt-1"), event(1, "message", "B", "x")]),
    ).toHaveLength(2);
  });

  it("keeps interleaved parallel attempts as one growing message each", () => {
    expect(
      summary([
        event(0, "message", "Quality ", "quality", "quality-review"),
        event(1, "message", "Security ", "security", "security-review"),
        event(2, "message", "looks fine.", "quality", "quality-review"),
        event(3, "message", "needs work.", "security", "security-review"),
      ]).map((entry) => [entry.attemptId, entry.detail, entry.lastSequence]),
    ).toEqual([
      ["quality", "Quality looks fine.", 2],
      ["security", "Security needs work.", 3],
    ]);
  });

  it("does not merge events that have no attempt", () => {
    const runLevel = (sequence: number): PublicEvent => {
      const { stepId: _stepId, attemptId: _attemptId, ...rest } = event(sequence, "message", "x");
      return rest;
    };
    expect(coalesceActivity([runLevel(0), runLevel(1)])).toHaveLength(2);
  });

  it("gives the same entries when rebuilt from persisted evidence as when streamed live", () => {
    const claimed = claimStep(
      claimStep(record, "quality-review", "candidate", "input"),
      "security-review",
      "candidate",
      "input",
    );
    const attempt = (stepId: string): [string, string] => {
      const id = claimed.steps.find((step) => step.stepId === stepId)?.attempts[0]?.id;
      if (!id) throw new Error(`Missing ${stepId} attempt`);
      return [id, stepId];
    };
    const quality = attempt("quality-review");
    const security = attempt("security-review");
    // Persisted evidence needs real ids for the run schema.
    const persisted = (
      sequence: number,
      type: PublicEvent["type"],
      detail: string,
      [attemptId, stepId]: [string, string],
    ): PublicEvent => ({
      ...event(sequence, type, detail, attemptId, stepId),
      id: crypto.randomUUID(),
    });
    const events = [
      persisted(0, "lifecycle", "", quality),
      persisted(1, "message", "Reading ", quality),
      persisted(2, "message", "files", security),
      persisted(3, "message", "the code.", quality),
      persisted(4, "tool", "rg TagMapping", quality),
      persisted(5, "message", " now.", security),
      persisted(6, "message", "Done.", quality),
    ];
    // Live: socket frames arrive out of order and some are delivered twice.
    let live = runRecordSchema.parse(claimed);
    const liveViews: ReturnType<typeof summary>[] = [];
    for (const index of [0, 2, 1, 3, 3, 5, 4, 6, 1]) {
      live = mergeRunEvent(live, events[index]!);
      liveViews.push(summary(live.evidence.filter((item) => item.kind === "event")));
    }
    // Reload: the persisted record is parsed back from JSON.
    const stored = runRecordSchema.parse(
      JSON.parse(JSON.stringify({ ...claimed, evidence: events })),
    );
    const reloaded = summary(stored.evidence.filter((item) => item.kind === "event"));
    expect(liveViews.at(-1)).toEqual(reloaded);
    expect(reloaded.map((entry) => entry.detail)).toEqual([
      "",
      "Reading the code.",
      "files now.",
      "rg TagMapping",
      "Done.",
    ]);
  });
});

describe("coalesceActivity human turn boundaries", () => {
  // Stored after the preceding event and before the next one, like the scheduler's receipts.
  const guidance = (state: "queued" | "delivered", attemptId = "attempt-1"): Evidence => ({
    id: `guidance-${state}-${attemptId}`,
    runId: record.snapshot.id,
    stepId: "build",
    attemptId,
    createdAt: new Date((clock += 100)).toISOString(),
    kind: "guidance",
    messageId: "message-1",
    message: "Use the existing helper",
    state,
  });
  const inputRequest = (): Evidence => ({
    id: "input-request-1",
    runId: record.snapshot.id,
    stepId: "build",
    attemptId: "attempt-1",
    createdAt: new Date((clock += 100)).toISOString(),
    kind: "input-request",
    sessionId: "session",
    turnId: "turn",
    itemId: "item",
    requestId: 1,
    questions: [{ id: "q", header: "Approach", question: "Which approach?", options: [] }],
    isBlocking: true,
    autoResolutionMs: null,
  });
  const details = (evidence: Evidence[]) =>
    coalesceActivity(evidence).map((entry) => [entry.type, entry.detail]);
  it("starts a new message for the reply after guidance is queued", () => {
    const evidence = [
      event(0, "message", "Reading "),
      event(1, "message", "the code."),
      guidance("queued"),
      event(2, "message", "Understood, "),
      // Delivery is stored after the steer call returns, possibly mid-reply.
      guidance("delivered"),
      event(3, "message", "switching approach."),
    ];
    expect(details(evidence)).toEqual([
      ["message", "Reading the code."],
      ["message", "Understood, switching approach."],
    ]);
    // Receipts are kept apart from events in the browser; order in the array must not matter.
    const receiptsLast = [
      ...evidence.filter((item) => item.kind === "event"),
      ...evidence.filter((item) => item.kind !== "event"),
    ];
    expect(details(receiptsLast)).toEqual(details(evidence));
  });
  it("starts a new message for the answer after a blocking question", () => {
    expect(
      details([
        event(0, "message", "Which approach "),
        event(1, "message", "should I use?"),
        inputRequest(),
        event(2, "message", "Using "),
        event(3, "message", "approach B."),
      ]),
    ).toEqual([
      ["message", "Which approach should I use?"],
      ["message", "Using approach B."],
    ]);
  });
  it("ignores guidance for another attempt", () => {
    expect(
      details([
        event(0, "message", "Still "),
        guidance("queued", "attempt-2"),
        event(1, "message", "going."),
      ]),
    ).toEqual([["message", "Still going."]]);
  });
});
describe("activityPreview", () => {
  it("bounds a long multi-line message to the newest characters of its last line", () => {
    const longLine = `${"word ".repeat(60)}end.`;
    const preview = activityPreview([
      event(0, "message", "# Review\n\n"),
      event(1, "message", "First finding.\n"),
      event(2, "message", longLine.slice(0, 100)),
      event(3, "message", `${longLine.slice(100)}\n\n`),
    ]);
    expect(preview).toBe(`…${longLine.slice(-119).trimStart()}`);
    expect(preview!.length).toBeLessThanOrEqual(120);
    expect(
      activityPreview([event(0, "message", "Line one\n"), event(1, "message", "  Line   two ")]),
    ).toBe("Line two");
  });
  it("marks a preview cut from the start of a very long single-line message", () => {
    const chunks = Array.from({ length: 20 }, (_, index) =>
      event(index, "message", `chunk-${index} `.padEnd(40, "x")),
    );
    const preview = activityPreview(chunks)!;
    expect(preview.startsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(120);
    expect(preview.endsWith(chunks.at(-1)!.detail!.trim())).toBe(true);
  });
  it("previews only the reply after a blocking question", () => {
    const before = event(0, "message", "Which one?");
    const question: Evidence = {
      id: "input-request-2",
      runId: record.snapshot.id,
      stepId: "build",
      attemptId: "attempt-1",
      createdAt: new Date((clock += 100)).toISOString(),
      kind: "input-request",
      sessionId: "session",
      turnId: "turn",
      itemId: "item",
      requestId: 2,
      questions: [{ id: "q", header: "Approach", question: "Which?", options: [] }],
      isBlocking: true,
      autoResolutionMs: null,
    };
    expect(activityPreview([before, question, event(1, "message", "Using B.")])).toBe("Using B.");
  });
  it("previews the full text of the most recently updated message", () => {
    expect(
      activityPreview([
        event(0, "message", "Quality ", "quality", "quality-review"),
        event(1, "message", "Security ok", "security", "security-review"),
        event(2, "message", "looks fine.", "quality", "quality-review"),
      ]),
    ).toBe("Quality looks fine.");
    expect(activityPreview([event(0, "message", "Hi"), event(1, "tool", "ok")])).toBe("pnpm test");
    expect(activityPreview([])).toBeUndefined();
  });
});
