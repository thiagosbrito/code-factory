import type { RunRecord } from "../../../domain/run.js";
import type { EvidenceSummary } from "../../../domain/acceptance.js";
import {
  acceptanceFreshness,
  definitionForScope,
  evidenceFreshness,
  scopeEvidence,
  stepForScope,
  type RunScope,
} from "./run-view-model";

export const RunInspectorDetails = ({
  run,
  scope,
  summary,
}: {
  run: RunRecord;
  scope: RunScope;
  summary: EvidenceSummary | null;
}) => {
  const definition = definitionForScope(run, scope);
  const step = stepForScope(run, scope);
  const attempt = step?.attempts.find(
    (item) => item.id === (scope.kind === "step" ? scope.attemptId : ""),
  );
  const receipts = scopeEvidence(run, scope).filter((item) => "provenance" in item);
  return (
    <div className="space-y-4 p-4 text-sm">
      {definition ? (
        <>
          <section className="rounded-lg border bg-muted/30 p-3">
            <h4 className="font-semibold">Instructions · {definition.name}</h4>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
              {definition.instruction}
            </p>
          </section>
          <dl className="run-details-grid">
            <dt>Role</dt>
            <dd>{definition.role}</dd>
            <dt>Kind</dt>
            <dd>{definition.kind}</dd>
            <dt>Agent / model</dt>
            <dd>
              {run.snapshot.bindings[definition.id]?.provider ?? "Unassigned"} ·{" "}
              {run.snapshot.bindings[definition.id]?.model ?? "Unassigned"}
              {run.snapshot.bindings[definition.id]?.effort
                ? ` · ${run.snapshot.bindings[definition.id]?.effort}`
                : ""}
            </dd>
            <dt>Attempt</dt>
            <dd>{attempt ? `${attempt.number} · ${attempt.status}` : "No attempt selected"}</dd>
            <dt>Step status</dt>
            <dd>{step?.status ?? "Unknown"}</dd>
            <dt>Dependencies</dt>
            <dd>
              {run.snapshot.loop.dependencies
                .filter((edge) => edge.to === definition.id)
                .map((edge) => edge.from)
                .join(", ") || "None"}
            </dd>
            <dt>Expected outputs</dt>
            <dd>{definition.expectedOutputs.join(", ") || "None declared"}</dd>
            <dt>Candidate</dt>
            <dd className="break-all">{step?.candidateId ?? "None yet"}</dd>
            <dt>Input hash</dt>
            <dd className="break-all">{step?.inputHash ?? "None yet"}</dd>
          </dl>
        </>
      ) : (
        <section className="rounded-lg border bg-muted/30 p-3">
          <h4 className="font-semibold">Run snapshot</h4>
          <p className="mt-2 whitespace-pre-wrap">{run.snapshot.task.description}</p>
        </section>
      )}
      <dl className="run-details-grid">
        <dt>Loop snapshot</dt>
        <dd>
          {run.snapshot.loop.name} v{run.snapshot.loop.version}
        </dd>
        <dt>Baseline</dt>
        <dd className="break-all">{run.snapshot.baseline.revision ?? run.snapshot.baseline.id}</dd>
        <dt>Source revision</dt>
        <dd className="break-all">{run.snapshot.baseline.sourceRevision ?? "Not recorded"}</dd>
        <dt>Workspace</dt>
        <dd className="break-all">{run.snapshot.baseline.workspace ?? "Not recorded"}</dd>
        <dt>Task source</dt>
        <dd>
          {run.snapshot.task.ticket
            ? `${run.snapshot.task.ticket.id} · ${run.snapshot.task.ticket.title}`
            : run.snapshot.task.ticketId
              ? `${run.snapshot.task.ticketId} · read through the agent's issue tracker MCP`
              : "Description only"}
        </dd>
        <dt>Captured</dt>
        <dd>{new Date(run.snapshot.baseline.capturedAt).toLocaleString()}</dd>
        <dt>Implementation round</dt>
        <dd>{run.implementationRound}</dd>
      </dl>
      {receipts.length > 0 && (
        <section>
          <h4 className="font-semibold">Evidence provenance</h4>
          <ul className="mt-2 space-y-2">
            {receipts.map((item) => (
              <li key={item.id} className="rounded-md border p-2 text-xs">
                <strong>{item.kind}</strong> · {item.provenance.source} ·{" "}
                {item.kind === "acceptance"
                  ? acceptanceFreshness(item, summary)
                  : evidenceFreshness(run, item)}
                <div className="mt-1 break-all text-muted-foreground">
                  Candidate {item.provenance.candidateId} · inputs{" "}
                  {item.provenance.inputReceiptIds.join(", ") || "none"}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
