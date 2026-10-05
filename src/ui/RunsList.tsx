import { useState } from "react";
import type { RunRecord } from "../domain/run.js";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { runStatus, runTitle } from "./run-view-model";

type StatusFilter = "All" | "Active" | "Waiting" | "Failed" | "Completed";
const filters: StatusFilter[] = ["All", "Active", "Waiting", "Failed", "Completed"];
const matchesStatus = (run: RunRecord, filter: StatusFilter): boolean =>
  filter === "All" ||
  (filter === "Active" && ["pending", "running"].includes(run.status)) ||
  (filter === "Waiting" && run.status === "waiting") ||
  (filter === "Failed" &&
    ["failed", "rejected", "blocked", "unavailable", "canceled"].includes(run.status)) ||
  (filter === "Completed" && run.status === "succeeded");

export const RunsList = ({ runs, onOpen }: { runs: RunRecord[]; onOpen: (id: string) => void }) => {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("All");
  const visible = runs.filter(
    (run) =>
      matchesStatus(run, filter) &&
      `${runTitle(run)} ${run.snapshot.task.ticket?.id ?? ""} ${run.snapshot.task.description} ${run.snapshot.loop.name} ${run.snapshot.id}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="mt-7" aria-label="Run history">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-sm bg-white"
          aria-label="Search runs, tickets, or tasks"
          placeholder="Search runs, tickets, or tasks"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Run status filters</legend>
          {filters.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={filter === item ? "secondary" : "ghost"}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
            </Button>
          ))}
        </fieldset>
      </div>
      <div className="mt-4 hidden grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_6rem_7rem_minmax(0,1fr)] gap-3 px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
        <span>Task</span>
        <span>Loop</span>
        <span>Status</span>
        <span>Started</span>
        <span>Last activity</span>
      </div>
      <div className="overflow-hidden rounded-lg border bg-white">
        {visible.map((run) => {
          const last = run.evidence.filter((item) => item.kind === "event").at(-1);
          return (
            <button
              key={run.snapshot.id}
              type="button"
              onClick={() => onOpen(run.snapshot.id)}
              className="grid w-full gap-2 border-b p-4 text-left last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_6rem_7rem_minmax(0,1fr)] lg:items-center lg:gap-3"
            >
              <span className="min-w-0">
                <strong className="block truncate text-sm">{runTitle(run)}</strong>
                <small className="block truncate text-xs text-muted-foreground">
                  {run.snapshot.task.ticket?.id ?? "Description only"} · {run.snapshot.id}
                </small>
              </span>
              <span className="text-sm">
                {run.snapshot.loop.name}{" "}
                <small className="text-muted-foreground">v{run.snapshot.loop.version}</small>
              </span>
              <span className={`run-status run-status-${run.status}`}>{runStatus(run)}</span>
              <time className="text-xs text-muted-foreground" dateTime={run.snapshot.createdAt}>
                {new Date(run.snapshot.createdAt).toLocaleDateString()}
              </time>
              <span className="truncate text-xs text-muted-foreground">
                {last?.title ?? "No activity yet"}
              </span>
            </button>
          );
        })}
        {!visible.length && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No runs match this search and status.
          </p>
        )}
      </div>
    </section>
  );
};
