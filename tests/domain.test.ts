import { describe, expect, it } from "vitest";
import { createLoopDraft, getDependentStepIds, parseLoop } from "../src/domain/loop.js";
import { createRunSnapshot } from "../src/domain/run.js";
import { mockAdapter } from "../src/adapters/mock.js";

function publishedLoop() {
  return parseLoop({
    ...createLoopDraft("review-loop", "Review loop"),
    status: "published",
    steps: ["implement", "quality", "security", "validate"].map((id) => ({
      id,
      name: id,
      kind: "agent",
      role: id,
      instruction: `Perform ${id}`,
    })),
    dependencies: [
      { from: "implement", to: "quality" },
      { from: "implement", to: "security" },
      { from: "quality", to: "validate" },
      { from: "security", to: "validate" },
    ],
  });
}

describe("portable loop contract", () => {
  it("starts with an empty draft and independent repair/retry limits", () => {
    const draft = createLoopDraft("blank-loop", "Blank loop");
    expect(draft.steps).toEqual([]);
    expect(draft.policy).toEqual({ maxAttemptsPerStep: 3, maxImplementationRounds: 2 });
    expect(() => parseLoop({ ...draft, status: "published" })).toThrow(
      /published loop needs a step/,
    );
  });
  it("rejects duplicate steps, missing references, cycles, and unknown fields", () => {
    const loop = publishedLoop();
    expect(() => parseLoop({ ...loop, steps: [...loop.steps, loop.steps[0]] })).toThrow(/unique/);
    expect(() =>
      parseLoop({ ...loop, dependencies: [{ from: "missing", to: "quality" }] }),
    ).toThrow(/existing steps/);
    expect(() =>
      parseLoop({
        ...loop,
        dependencies: [...loop.dependencies, { from: "validate", to: "implement" }],
      }),
    ).toThrow(/cycles/);
    expect(() => parseLoop({ ...loop, silentUnsupportedSetting: true })).toThrow(
      /Unrecognized key/,
    );
  });
  it("preserves independent siblings while finding transitive consumers", () => {
    expect(getDependentStepIds(publishedLoop(), "quality")).toEqual(["validate"]);
    expect(getDependentStepIds(publishedLoop(), "implement")).toEqual([
      "quality",
      "security",
      "validate",
    ]);
  });
  it("keeps canvas coordinates independent of dependency ordering", () => {
    const loop = publishedLoop();
    const moved = parseLoop({
      ...loop,
      steps: loop.steps.map((step) => ({ ...step, position: { x: -500, y: 999 } })),
    });
    expect(moved.dependencies).toEqual(loop.dependencies);
  });
});

describe("run snapshots", () => {
  it("copies task, loop, and model defaults so later edits cannot change a run", () => {
    const loop = publishedLoop();
    const task = { description: "Implement activity filters" };
    const binding = { provider: "mock" as const, model: "agent-default" };
    const run = createRunSnapshot(loop, task, binding);
    loop.name = "New name";
    task.description = "Different task";
    binding.model = "different-model";
    expect(run.loop.name).toBe("Review loop");
    expect(run.task.description).toBe("Implement activity filters");
    expect(run.bindings.implement?.model).toBe("agent-default");
  });
  it("preserves explicit step assignments and rejects blank tasks or drafts", () => {
    const loop = publishedLoop();
    const configured = {
      ...loop,
      steps: loop.steps.map((step) =>
        step.id === "quality"
          ? { ...step, binding: { provider: "codex" as const, model: "agent-default" } }
          : step,
      ),
    };
    const run = createRunSnapshot(
      configured,
      { description: "Task" },
      { provider: "mock", model: "agent-default" },
    );
    expect(run.bindings.quality?.provider).toBe("codex");
    expect(() =>
      createRunSnapshot(loop, { description: " " }, { provider: "mock", model: "agent-default" }),
    ).toThrow(/description or ticket ID/);
    expect(() =>
      createRunSnapshot(
        createLoopDraft("draft", "Draft"),
        { description: "Task" },
        { provider: "mock", model: "agent-default" },
      ),
    ).toThrow(/Publish the loop/);
  });
});

describe("mock adapter", () => {
  const input = {
    runId: "run",
    stepId: "quality",
    attempt: 1,
    instruction: "Review changes",
    projectDirectory: "/tmp/mock-project",
    binding: { provider: "mock" as const, model: "agent-default" },
  };
  it("emits ordered public events and declares unavailable controls honestly", async () => {
    const events = [];
    for await (const event of mockAdapter.execute(input, new AbortController().signal))
      events.push(event);
    expect(events.map((event) => event.type)).toEqual(["started", "message", "completed"]);
    expect(mockAdapter.capabilities.steering).toBe("unsupported");
    expect(mockAdapter.capabilities.resume).toBe("unsupported");
  });
  it("does not report success for canceled work", async () => {
    const controller = new AbortController();
    const iterator = mockAdapter.execute(input, controller.signal)[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort();
    await expect(iterator.next()).rejects.toThrow(/aborted/i);
  });
});
