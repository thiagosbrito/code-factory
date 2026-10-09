import { useEffect, useState } from "react";
import type { RunRecord } from "../../../domain/run.js";
import {
  downloadBytes,
  listInspectionFiles,
  readInspectionDiff,
  type InspectedChange,
  type InspectedFiles,
} from "./inspection-api";
import { evidenceFreshness, type RunScope } from "./run-view-model";
import { Input } from "@/shared/components/input";
import { NativeSelect } from "@/shared/components/native-select";

export const RunInspectorFiles = ({ run, scope }: { run: RunRecord; scope: RunScope }) => {
  const [data, setData] = useState<InspectedFiles | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState("");
  const [diffResult, setDiffResult] = useState<{
    path: string;
    diff?: string;
    error?: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    listInspectionFiles(run.snapshot.id).then(
      (result) => {
        if (live) {
          setData(result);
          setError("");
        }
      },
      (reason: unknown) => {
        if (live)
          setError(reason instanceof Error ? reason.message : "File changes are unavailable.");
      },
    );
    return () => {
      live = false;
    };
  }, [run.snapshot.id, run.revision]);
  const available = (data?.files ?? []).filter(
    (item) =>
      scope.kind === "run" ||
      (item.stepId === scope.stepId && (!scope.attemptId || item.attemptId === scope.attemptId)),
  );
  const visible = available.filter(
    (item) =>
      item.path.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" || item.change === filter),
  );
  const active = visible.find((item) => item.path === selected) ?? visible[0];
  const activePath = active?.path;
  useEffect(() => {
    let live = true;
    if (activePath)
      readInspectionDiff(run.snapshot.id, activePath).then(
        (result) => {
          if (live) setDiffResult({ path: activePath, diff: result.diff });
        },
        (reason: unknown) => {
          if (live)
            setDiffResult({
              path: activePath,
              error: reason instanceof Error ? reason.message : "Diff unavailable.",
            });
        },
      );
    return () => {
      live = false;
    };
  }, [run.snapshot.id, activePath, run.revision]);
  const diff = diffResult && diffResult.path === activePath ? (diffResult.diff ?? "") : "";
  const diffError = diffResult && diffResult.path === activePath ? (diffResult.error ?? "") : "";
  const freshness = (item: InspectedChange) => {
    const receipt = run.evidence.find((entry) => entry.id === item.receiptId);
    return receipt ? evidenceFreshness(run, receipt) : (item.freshness ?? "unknown");
  };
  const row = (item: InspectedChange) => (
    <span className="block min-w-0">
      <span className="block break-all font-medium">{item.path}</span>
      <span className="text-xs text-muted-foreground">
        {item.change} ·{" "}
        {item.attribution === "uncertain"
          ? "Attribution uncertain"
          : `Step ${item.stepId} · Attempt ${item.attemptId} · ${freshness(item)}`}
      </span>
    </span>
  );
  if (error)
    return (
      <p role="alert" className="p-4 text-sm">
        {error}
      </p>
    );
  if (!data) return <p className="p-4 text-sm">Loading file changes…</p>;
  return (
    <div className="space-y-3 p-4 text-sm">
      <p className="rounded border bg-muted/30 p-2 text-xs">
        Task changes compared with baseline{" "}
        <code className="break-all">{data.baselineRevision}</code>. Attribution is uncertain where
        no matching file receipt exists.
      </p>
      <div className="flex gap-2">
        <Input
          aria-label="Search paths"
          placeholder="Search paths"
          className="min-w-0 flex-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <NativeSelect
          aria-label="Change type"
          className="w-40"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All changes</option>
          {["added", "modified", "deleted", "renamed"].map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </NativeSelect>
      </div>
      {!available.length && (
        <p className="rounded border p-4 text-muted-foreground">
          No task changes are available for this scope. Select run scope to inspect unattributed
          changes.
        </p>
      )}
      {available.length > 0 && !visible.length && (
        <p className="rounded border p-4 text-muted-foreground">No paths match these filters.</p>
      )}
      <div className="space-y-1" aria-label="Changed files">
        {visible.map((item) => (
          <button
            key={item.path}
            type="button"
            aria-current={active?.path === item.path ? "true" : undefined}
            className="block w-full rounded border p-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => setSelected(item.path)}
          >
            {row(item)}
          </button>
        ))}
      </div>
      {active && (
        <section aria-label="Selected diff" className="rounded border">
          <div className="flex items-center justify-between gap-2 border-b p-2">
            <strong className="break-all">{active.path}</strong>
            <button
              type="button"
              disabled={!diff}
              className="rounded border px-2 py-1 disabled:opacity-50"
              onClick={() =>
                downloadBytes(
                  `${active.path.split("/").at(-1)}.diff`,
                  new TextEncoder().encode(diff),
                  "text/x-diff;charset=utf-8",
                )
              }
            >
              Download diff
            </button>
          </div>
          {diffError ? (
            <p role="alert" className="p-3">
              {diffError}
            </p>
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">
              {diff || "Loading diff…"}
            </pre>
          )}
        </section>
      )}
      {scope.kind === "run" && data.preExisting.length > 0 && (
        <section className="rounded border bg-muted/20 p-3">
          <h3 className="font-semibold">Pre-existing changes ({data.preExisting.length})</h3>
          <p className="text-xs text-muted-foreground">
            Captured before this task; excluded from task diffs.
          </p>
          <ul className="mt-2 space-y-1">
            {data.preExisting.map((item) => (
              <li key={item.path}>{row(item)}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
