// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  attachAttemptSession,
  setAttemptControlState,
  runRecordSchema,
} from "../src/domain/run.js";
import { RunInputPrompt } from "../src/ui/features/runs/RunInputPrompt.js";
import { RunGuidance } from "../src/ui/features/runs/RunGuidance.js";
import { type AgentConnection } from "../src/adapters/contract.js";
import { type RunScope } from "../src/ui/features/runs/run-view-model.js";
import { makeRun } from "./support/runs-ui.js";

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
