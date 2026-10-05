import { useEffect, useState } from "react";
import type { RunRecord } from "../domain/run.js";
import type { Evidence } from "../domain/evidence.js";
import {
  decodeArtifact,
  downloadBytes,
  readInspectionArtifact,
  type InspectedArtifact,
} from "./inspection-api";
import { evidenceFreshness, scopeEvidence, type RunScope } from "./run-view-model";

type ArtifactReceipt = Extract<Evidence, { kind: "artifact" }>;
const previewType = (mediaType: string) => {
  const type = mediaType.split(";")[0]?.trim().toLowerCase();
  if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type ?? "")) return "image";
  if (type === "application/json") return "json";
  if (["text/markdown", "text/x-markdown"].includes(type ?? "")) return "markdown";
  if (type === "text/plain") return "text";
  return "unsupported";
};
const previewText = (base64: string) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(decodeArtifact(base64));
  } catch {
    return null;
  }
};
const MarkdownPreview = ({ source }: { source: string }) => (
  <div className="max-h-96 space-y-2 overflow-auto break-words p-3 text-sm">
    {source.split("\n").map((line, index) =>
      line.startsWith("## ") ? (
        <h4 key={index} className="font-semibold">
          {line.slice(3)}
        </h4>
      ) : line.startsWith("# ") ? (
        <h3 key={index} className="text-base font-semibold">
          {line.slice(2)}
        </h3>
      ) : line.startsWith("- ") ? (
        <p key={index} className="pl-3">
          • {line.slice(2)}
        </p>
      ) : (
        <p key={index}>{line || "\u00a0"}</p>
      ),
    )}
  </div>
);

export const RunInspectorArtifacts = ({ run, scope }: { run: RunRecord; scope: RunScope }) => {
  const receipts = scopeEvidence(run, scope).filter(
    (item): item is ArtifactReceipt => item.kind === "artifact",
  );
  const [selected, setSelected] = useState("");
  const active = receipts.find((item) => item.id === selected) ?? receipts[0];
  const [result, setResult] = useState<{
    id: string;
    artifact?: InspectedArtifact;
    error?: string;
  } | null>(null);
  const activeId = active?.id;
  useEffect(() => {
    let live = true;
    if (activeId)
      readInspectionArtifact(run.snapshot.id, activeId).then(
        (result) => {
          if (live) setResult({ id: activeId, artifact: result });
        },
        (reason: unknown) => {
          if (live)
            setResult({
              id: activeId,
              error: reason instanceof Error ? reason.message : "Artifact unavailable.",
            });
        },
      );
    return () => {
      live = false;
    };
  }, [run.snapshot.id, activeId, run.revision]);
  if (!receipts.length)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No declared evidence artifacts for this scope. Changed source files are listed under Files.
      </p>
    );
  const artifact = result && result.id === activeId ? result.artifact : undefined;
  const error = result && result.id === activeId ? result.error : undefined;
  const type = artifact ? previewType(artifact.mediaType) : "unsupported";
  const imageUrl =
    artifact && type === "image" ? `data:${artifact.mediaType};base64,${artifact.base64}` : "";
  const text =
    artifact && type !== "image" && type !== "unsupported" ? previewText(artifact.base64) : null;
  return (
    <div className="space-y-3 p-4 text-sm">
      <div aria-label="Artifact receipts" className="space-y-1">
        {receipts.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={active?.id === item.id ? "true" : undefined}
            className="block w-full rounded border p-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => setSelected(item.id)}
          >
            <strong>{item.name}</strong>
            <span className="block text-xs text-muted-foreground">
              {item.mediaType} · {item.stepId} · Attempt{" "}
              {run.steps
                .find((step) => step.stepId === item.stepId)
                ?.attempts.find((attempt) => attempt.id === item.attemptId)?.number ??
                item.attemptId}{" "}
              · {evidenceFreshness(run, item)}
            </span>
          </button>
        ))}
      </div>
      {active && (
        <section className="rounded border">
          <div className="flex items-center justify-between gap-2 border-b p-3">
            <strong className="break-all">{active.name}</strong>
            <button
              type="button"
              className="rounded border px-2 py-1 disabled:opacity-50"
              disabled={!artifact}
              onClick={() => {
                if (artifact)
                  downloadBytes(active.name, decodeArtifact(artifact.base64), artifact.mediaType);
              }}
            >
              Download
            </button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 p-3 text-xs">
            <dt>Produced</dt>
            <dd>{new Date(active.createdAt).toLocaleString()}</dd>
            <dt>Run / step / attempt</dt>
            <dd className="break-all">
              {active.runId} / {active.stepId} / {active.attemptId}
            </dd>
            <dt>Source</dt>
            <dd>{active.provenance.source}</dd>
            <dt>Baseline / candidate</dt>
            <dd className="break-all">
              {active.provenance.baselineId} / {active.provenance.candidateId}
            </dd>
            <dt>Input receipts</dt>
            <dd className="break-all">{active.provenance.inputReceiptIds.join(", ") || "None"}</dd>
            <dt>Freshness</dt>
            <dd>
              {evidenceFreshness(run, active)}
              {active.freshness.reason ? ` · ${active.freshness.reason}` : ""}
            </dd>
          </dl>
          {error ? (
            <p role="alert" className="p-3">
              {error}
            </p>
          ) : !artifact ? (
            <p className="p-3 text-muted-foreground">Loading artifact…</p>
          ) : text === null && type !== "image" && type !== "unsupported" ? (
            <p role="alert" className="p-3">
              This text artifact is not valid UTF-8. Download it to inspect the original bytes.
            </p>
          ) : type === "image" ? (
            imageUrl ? (
              <img
                className="max-h-96 max-w-full p-3"
                src={imageUrl}
                alt={`Artifact ${active.name}`}
              />
            ) : (
              <p className="p-3">Loading image…</p>
            )
          ) : type === "unsupported" ? (
            <p className="p-3 text-muted-foreground">
              Preview unavailable for this file type. Download the artifact to inspect it.
            </p>
          ) : type === "json" ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(text ?? ""), null, 2);
                } catch {
                  return text;
                }
              })()}
            </pre>
          ) : type === "markdown" ? (
            <MarkdownPreview source={text ?? ""} />
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">
              {text}
            </pre>
          )}
        </section>
      )}
    </div>
  );
};
