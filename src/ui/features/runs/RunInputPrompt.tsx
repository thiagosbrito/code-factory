import { useState, type FormEvent } from "react";
import type { AgentConnection } from "../../../adapters/contract.js";
import type { RunRecord } from "../../../domain/run.js";
import { Button } from "@/shared/components/button";

type InputRequest = Extract<RunRecord["evidence"][number], { kind: "input-request" }>;
type InputReplyEvidence = Extract<RunRecord["evidence"][number], { kind: "input-reply" }>;

const currentRequest = (
  run: RunRecord,
): { request: InputRequest; reply: InputReplyEvidence | undefined } | null => {
  for (const step of run.steps) {
    const attempt = step.attempts.at(-1);
    if (attempt?.status !== "waiting-input") continue;
    const request = [...run.evidence]
      .reverse()
      .find(
        (item): item is InputRequest =>
          item.kind === "input-request" && item.attemptId === attempt.id,
      );
    if (request && request.sessionId === attempt.sessionId && request.turnId === attempt.turnId)
      return {
        request,
        reply: [...run.evidence]
          .reverse()
          .find(
            (item): item is InputReplyEvidence =>
              item.kind === "input-reply" && item.requestEvidenceId === request.id,
          ),
      };
  }
  return null;
};

export const RunInputPrompt = ({
  run,
  agents,
  connected,
  onReply,
}: {
  run: RunRecord;
  agents: AgentConnection[];
  connected: boolean;
  onReply: (input: {
    stepId: string;
    attemptId: string;
    requestEvidenceId: string;
    answers: Record<string, { answers: string[] }>;
  }) => Promise<void>;
}) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const current = currentRequest(run);
  if (!current) return null;
  const { request, reply } = current;
  if (reply?.state === "sent") return null;
  if (reply)
    return (
      <output className="block rounded-lg border border-amber-300 bg-amber-50 p-5">
        <h3 className="font-semibold">Reply delivery is unconfirmed</h3>
        <p className="mt-1 text-sm">
          The answer was recorded before sending, but its delivery could not be confirmed. Cancel
          this run and retry the step to receive a new native request.
        </p>
      </output>
    );
  const provider = run.snapshot.bindings[request.stepId]?.provider;
  const supported = agents.some(
    (agent) => agent.provider === provider && agent.capabilities.waitingInput === "supported",
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSending(true);
    try {
      await onReply({
        stepId: request.stepId,
        attemptId: request.attemptId,
        requestEvidenceId: request.id,
        answers: Object.fromEntries(
          request.questions.map((question) => [
            question.id,
            { answers: [(values[question.id] ?? "").trim()] },
          ]),
        ),
      });
      setValues({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the reply.");
    } finally {
      setSending(false);
    }
  };
  return (
    <section
      className="rounded-lg border border-amber-300 bg-amber-50 p-5"
      aria-label="Agent input request"
    >
      <h3 className="font-semibold">Agent waiting for input</h3>
      <p className="mt-1 text-sm">The active turn is waiting for your answers.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        This request has no verified timeout. Cancel the run if you do not want to answer; a
        canceled or restarted attempt requires a new request.
      </p>
      <form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)}>
        {request.questions.map((question) => (
          <div key={question.id}>
            <label
              className="block text-sm font-medium"
              htmlFor={`input-${request.id}-${question.id}`}
            >
              {question.header || question.question}
            </label>
            {question.header && <p className="text-sm">{question.question}</p>}
            {question.options.length > 0 && (
              <div className="mt-1 space-y-1 text-sm">
                {question.options.map((option) => (
                  <p key={option.label}>
                    {option.label} · {option.description}
                  </p>
                ))}
              </div>
            )}
            <input
              id={`input-${request.id}-${question.id}`}
              className="mt-2 w-full rounded-md border bg-white px-3 py-2 text-sm"
              value={values[question.id] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [question.id]: event.target.value }))
              }
              required
              disabled={!connected || !supported || sending}
            />
          </div>
        ))}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {!supported && (
          <p className="text-sm">Native input replies are unavailable for this connection.</p>
        )}
        <Button
          type="submit"
          disabled={
            !connected ||
            !supported ||
            sending ||
            request.questions.some((question) => !values[question.id]?.trim())
          }
        >
          {sending ? "Sending…" : "Send answers"}
        </Button>
      </form>
    </section>
  );
};
