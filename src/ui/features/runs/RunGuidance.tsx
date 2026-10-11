import { useState } from "react";
import type { AgentConnection } from "../../../adapters/contract.js";
import type { RunRecord } from "../../../domain/run.js";
import { Button } from "@/shared/components/button";
import { Textarea } from "@/shared/components/textarea";
import { scopeEvidence, type RunScope } from "./run-view-model";

type Submit = (input: { stepId: string; attemptId: string; message: string }) => Promise<void>;

/**
 * Step guidance for the selected attempt. It is shown only when that attempt's agent can take
 * guidance (Claude Code and some Codex versions); for an agent that cannot (Kiro, an unknown
 * Codex version) or with no attempt selected, nothing is rendered rather than a control that
 * could never work.
 */
export const RunGuidance = ({
  run,
  scope,
  connected,
  agents,
  onSend,
}: {
  run: RunRecord;
  scope: RunScope;
  connected: boolean;
  agents: AgentConnection[];
  onSend: Submit;
}) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const target =
    scope.kind === "step" && scope.attemptId
      ? {
          stepId: scope.stepId,
          attemptId: scope.attemptId,
        }
      : null;
  const key = target ? `${run.snapshot.id}:${target.stepId}:${target.attemptId}` : "";
  const message = drafts[key] ?? "";
  const provider = target ? run.snapshot.bindings[target.stepId]?.provider : undefined;
  const connection = agents.find((item) => item.provider === provider);
  const steering = connection?.capabilities.steering ?? "unknown";
  const verified =
    connection?.authentication === "authenticated" || connection?.authentication === "not-required";
  const canSend = Boolean(target && connected && verified && message.trim() && !sending);
  const guidance = scopeEvidence(run, scope).filter((item) => item.kind === "guidance");
  const latest = guidance.filter(
    (item, index) => !guidance.slice(index + 1).some((other) => other.messageId === item.messageId),
  );
  const status = !connected
    ? "Runtime disconnected. Draft preserved until it reconnects."
    : !verified
      ? "A verified agent connection is required. Draft preserved."
      : run.status !== "running"
        ? `Run ${run.status}. Guidance for a finished attempt is recorded as undelivered.`
        : "Guidance is queued for this exact attempt. Delivery does not interrupt or restart work.";
  if (!target || steering !== "supported") return null;
  return (
    <section className="border-t p-4" aria-label="Step guidance">
      <h3 className="text-sm font-semibold">Step guidance</h3>
      <p className="mt-1 text-xs text-muted-foreground">{status}</p>
      {latest.length > 0 && (
        <ol className="mt-3 max-h-36 space-y-2 overflow-auto" aria-label="Guidance history">
          {latest.map((item) => (
            <li key={item.messageId} className="rounded-md border p-2 text-xs">
              <div className="flex justify-between gap-2">
                <strong className="capitalize">{item.state}</strong>
                <span>
                  {item.stepId} · {item.attemptId.slice(0, 8)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words">{item.message}</p>
              {item.reason && <p className="mt-1 text-muted-foreground">{item.reason}</p>}
            </li>
          ))}
        </ol>
      )}
      <form
        className="mt-3 space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!target || !canSend) return;
          setSending(true);
          setError("");
          try {
            await onSend({ ...target, message: message.trim() });
            setDrafts((current) => ({ ...current, [key]: "" }));
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not send guidance.");
          } finally {
            setSending(false);
          }
        }}
      >
        <label htmlFor="step-guidance-draft" className="text-xs font-medium">
          Message for selected attempt
        </label>
        <Textarea
          id="step-guidance-draft"
          className="min-h-20"
          value={message}
          onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
          maxLength={10000}
        />
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" size="sm" disabled={!canSend}>
          {sending ? "Sending…" : "Queue guidance"}
        </Button>
      </form>
    </section>
  );
};
