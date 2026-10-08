import type { EvidenceSummary } from "../domain/acceptance.js";
import { Button } from "@/components/ui/button";
import { Markdown } from "./Markdown";

/** Counts, requirements, gaps and findings of a run's final evidence, shown in its dialog. */
export const RunEvidenceSummary = ({
  summary,
  complete,
  total,
  onOpenFiles,
  onOpenArtifacts,
}: {
  summary: EvidenceSummary | null;
  complete: number;
  total: number;
  onOpenFiles: () => void;
  onOpenArtifacts: () => void;
}) => {
  const files = summary?.files.length ?? 0;
  const artifacts = summary?.artifacts.length ?? 0;
  const met = summary?.requirements.filter((item) => item.state === "met").length ?? 0;
  return (
    <div className="space-y-5">
      <section className="grid gap-2 sm:grid-cols-4" aria-label="Run summary">
        <Button
          variant="outline"
          className="h-auto justify-between bg-white p-3"
          onClick={onOpenFiles}
        >
          Changed files <strong>{files}</strong>
        </Button>
        <Button
          variant="outline"
          className="h-auto justify-between bg-white p-3"
          onClick={onOpenArtifacts}
        >
          Artifacts <strong>{artifacts}</strong>
        </Button>
        <div className="rounded-md border bg-white p-3 text-sm">
          Requirements met <strong className="float-right">{met}</strong>
        </div>
        <div className="rounded-md border bg-white p-3 text-sm">
          Loop progress{" "}
          <strong className="float-right">
            {complete}/{total}
          </strong>
        </div>
      </section>
      {summary?.acceptedAt && (
        <p className="text-xs text-muted-foreground">
          Accepted {new Date(summary.acceptedAt).toLocaleString()}
        </p>
      )}
      {summary?.acceptance === "invalidated" && (
        <p className="text-sm text-amber-800">
          Earlier acceptance remains in the evidence history. Current inputs require fresh
          validation and acceptance.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium">Requirements</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {summary?.requirements.map((item) => (
              <li key={item.stepId}>
                <strong>{item.name}</strong>:{" "}
                {item.state === "met"
                  ? "Met"
                  : item.state === "not-required"
                    ? "Not required"
                    : item.reason}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-medium">Validation gaps</h3>
          {summary?.gaps.length ? (
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
              {summary.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">None</p>
          )}
        </div>
        <div className="md:col-span-2">
          <h3 className="text-sm font-medium">Review findings</h3>
          {summary?.reviews?.length ? (
            <ul className="mt-2 space-y-3">
              {summary.reviews.map((review) => (
                <li key={review.stepId} className="rounded-md border bg-white p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {review.name}
                    <span
                      className={`run-status run-status-${review.verdict === "pass" ? "succeeded" : "blocked"}`}
                    >
                      {review.verdict}
                    </span>
                  </p>
                  {/* Findings are stored line by line; each line stays its own block. */}
                  <Markdown className="mt-2">{review.findings.join("\n\n")}</Markdown>
                </li>
              ))}
            </ul>
          ) : summary?.findings.length ? (
            <Markdown className="mt-2">{summary.findings.join("\n\n")}</Markdown>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">None</p>
          )}
        </div>
      </div>
    </div>
  );
};
