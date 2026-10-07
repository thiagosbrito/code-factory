import { useState } from "react";
import type { RunRecord } from "../domain/run.js";
import type { PublicEvent } from "../runtime/events.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type Filter = "all" | "message" | "tool" | "check" | "error";
const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "message", label: "Messages" },
  { value: "tool", label: "Tools" },
  { value: "check", label: "Checks" },
  { value: "error", label: "Errors" },
];

const EventCard = ({ event }: { event: PublicEvent }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="flex gap-3 border-b border-border py-3 text-sm last:border-b-0">
      <span className="mt-1 size-2 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <strong className="font-semibold capitalize text-foreground">{event.type}</strong>
          <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
          {event.state && <span>· {event.state}</span>}
        </div>
        <p className="mt-1 break-words font-medium">{event.title}</p>
        {event.detail && event.type !== "tool" && (
          <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
            {event.detail}
          </p>
        )}
        {event.detail && event.type === "tool" && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 px-0"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Hide details" : "Show details"}
            </Button>
            {expanded && (
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{event.detail}</pre>
            )}
          </>
        )}
      </div>
    </li>
  );
};

export const RunActivity = ({ run, connected }: { run: RunRecord; connected: boolean }) => {
  const [stepId, setStepId] = useState("");
  const [attemptId, setAttemptId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const step = run.steps.find((item) => item.stepId === stepId);
  const events = run.evidence
    .filter((item): item is PublicEvent => item.kind === "event")
    .filter((item) => !stepId || item.stepId === stepId)
    .filter((item) => !attemptId || item.attemptId === attemptId)
    .filter((item) => filter === "all" || item.type === filter)
    .filter((item) =>
      `${item.title} ${item.detail ?? ""}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => a.sequence - b.sequence);
  return (
    <section className="mt-6 rounded-lg border bg-card p-4" aria-label="Activity">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Activity</h3>
        <span className="text-xs text-muted-foreground">
          {connected ? "Runtime reachable" : "Disconnected · execution state unknown"}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <label className="text-xs text-muted-foreground">
          Step
          <NativeSelect
            className="mt-1 min-w-40 text-foreground"
            value={stepId}
            onChange={(event) => {
              setStepId(event.target.value);
              setAttemptId("");
            }}
          >
            <option value="">All steps</option>
            {run.snapshot.loop.steps.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        {step && (
          <label className="text-xs text-muted-foreground">
            Attempt
            <NativeSelect
              className="mt-1 min-w-32 text-foreground"
              value={attemptId}
              onChange={(event) => setAttemptId(event.target.value)}
            >
              <option value="">All attempts</option>
              {step.attempts.map((attempt) => (
                <option key={attempt.id} value={attempt.id}>
                  Attempt {attempt.number}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
      </div>
      <fieldset className="mt-3 flex flex-wrap gap-1">
        <legend className="sr-only">Activity filters</legend>
        {filters.map((item) => (
          <Button
            key={item.value}
            size="sm"
            variant={filter === item.value ? "secondary" : "ghost"}
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </fieldset>
      <Input
        className="mt-3"
        aria-label="Search activity"
        placeholder="Search activity"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <ol className="mt-3 max-h-80 overflow-y-auto" aria-live="polite">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </ol>
      {!events.length && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No matching activity. A quiet stream does not mean the step failed.
        </p>
      )}
    </section>
  );
};
