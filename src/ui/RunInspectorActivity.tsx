import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RunRecord } from "../domain/run.js";
import type { Evidence } from "../domain/evidence.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scopeEvidence, type RunScope } from "./run-view-model";
import { coalesceActivity, latestSequence, showsTitle } from "./activity-entries";

type Filter = "All" | "Messages" | "Tools" | "Checks" | "Errors";
const filters: Filter[] = ["All", "Messages", "Tools", "Checks", "Errors"];
const matchesFilter = (item: Extract<Evidence, { kind: "event" }>, filter: Filter): boolean =>
  filter === "All" ||
  (filter === "Messages" && ["message", "lifecycle", "guidance"].includes(item.type)) ||
  (filter === "Tools" && item.type === "tool") ||
  (filter === "Checks" && item.type === "check") ||
  (filter === "Errors" && item.type === "error");

export const RunInspectorActivity = ({
  run,
  scope,
  connected,
}: {
  run: RunRecord;
  scope: RunScope;
  connected: boolean;
}) => {
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");
  const [followLive, setFollowLive] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const scrollPositions = useRef(new Map<string, number>());
  const scroller = useRef<HTMLOListElement>(null);
  const key =
    scope.kind === "run" ? `run:${run.snapshot.id}` : `${scope.stepId}:${scope.attemptId ?? "all"}`;
  // Coalesce before filtering so a hidden tool event still ends the message it interrupted.
  // Guidance and question receipts in scope end the message they interrupted.
  const events = coalesceActivity(scopeEvidence(run, scope)).filter(
    (item) =>
      matchesFilter(item, filter) &&
      `${item.title} ${item.detail ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  // A growing message moves the live edge without adding an entry.
  const lastSequence = latestSequence(events);
  const previous = useRef({ key, lastSequence });
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = scrollPositions.current.get(key) ?? 0;
    setNewCount(0);
  }, [key]);
  useEffect(() => {
    const prior = previous.current;
    previous.current = { key, lastSequence };
    if (prior.key !== key || lastSequence <= prior.lastSequence) return;
    if (followLive) {
      const element = scroller.current;
      if (element) element.scrollTop = element.scrollHeight;
    } else
      setNewCount(
        (value) => value + events.filter((event) => event.sequence > prior.lastSequence).length,
      );
  }, [key, lastSequence, followLive, events]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b p-3">
        <Input
          aria-label="Search activity"
          placeholder="Search activity"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Activity filters</legend>
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
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={followLive}
            onChange={(event) => {
              setFollowLive(event.target.checked);
              if (event.target.checked) {
                setNewCount(0);
                const element = scroller.current;
                if (element) element.scrollTop = element.scrollHeight;
              }
            }}
          />
          Follow live
        </label>
        <p className="text-xs text-muted-foreground">
          {connected ? "Runtime reachable" : "Disconnected · execution state unknown"}
        </p>
      </div>
      <ol
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4"
        aria-label="Activity events"
        onScroll={(event) => scrollPositions.current.set(key, event.currentTarget.scrollTop)}
      >
        {events.map((item) => (
          <li
            key={item.id}
            className="min-w-0 border-b py-3 text-sm [overflow-wrap:anywhere] last:border-b-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`run-status run-status-${item.type}`}>{item.type}</span>
              <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString()}
              </time>
            </div>
            {showsTitle(item) && <strong className="mt-1 block">{item.title}</strong>}
            {item.detail && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                {item.detail}
              </p>
            )}
          </li>
        ))}
        {!events.length && (
          <li className="p-6 text-center text-sm text-muted-foreground">
            No matching activity. A quiet stream does not mean the step failed.
          </li>
        )}
      </ol>
      {newCount > 0 && !followLive && (
        <Button
          variant="outline"
          size="sm"
          className="m-3"
          onClick={() => {
            const element = scroller.current;
            if (element) {
              element.scrollTop = element.scrollHeight;
              scrollPositions.current.set(key, element.scrollTop);
            }
            setNewCount(0);
          }}
        >
          {newCount} new events · Jump to latest
        </Button>
      )}
    </div>
  );
};
