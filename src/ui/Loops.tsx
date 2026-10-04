import { useEffect, useRef, useState } from "react";
import type { AgentConnection } from "../adapters/contract.js";
import { createLoopDraft, type LoopDefinition } from "../domain/loop.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, type ProjectResponse } from "./project-api";
import { LoopEditor } from "./LoopEditor";

type Entry = {
  id: string;
  draft: LoopDefinition | null;
  published: LoopDefinition | null;
  versions: number[];
};

function LoopCard({
  loop,
  versions,
  onEdit,
}: {
  loop: LoopDefinition;
  versions?: number[];
  onEdit?: () => void;
}) {
  return (
    <Card className="grid gap-3 bg-white p-5 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
      <div
        aria-hidden="true"
        className="flex h-16 items-center justify-around rounded-lg border bg-stone-50 text-teal-700"
      >
        <span className="rounded border bg-white px-2 py-1">1</span>
        <span>→</span>
        <span className="rounded border bg-white px-2 py-1">2</span>
        <span>→</span>
        <span className="rounded border bg-white px-2 py-1">3</span>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
          {loop.status === "draft" ? `Draft v${loop.version}` : `Published v${loop.version}`}
        </p>
        <h3 className="font-semibold">{loop.name}</h3>
        <p className="text-sm text-muted-foreground">
          {loop.steps.length} steps
          {versions?.length
            ? ` · Publications: ${versions.map((version) => `v${version}`).join(", ")}`
            : ""}
        </p>
        {loop.status === "published" && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer text-teal-700">Inspect published structure</summary>
            <p className="mt-2">{`Steps: ${loop.steps.map((step) => step.name).join(", ")}`}</p>
            <p>
              {loop.groups.length} groups · {loop.joins.length} joins · {loop.decisions.length}{" "}
              decisions
            </p>
          </details>
        )}
      </div>
      {onEdit && (
        <Button variant="outline" onClick={onEdit}>
          Edit draft
        </Button>
      )}
    </Card>
  );
}
export function Loops({
  project,
  agents,
  onTemplate,
  onPublished,
}: {
  project: ProjectResponse;
  agents: AgentConnection[];
  onTemplate: () => void;
  onPublished?: (loop: LoopDefinition) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<LoopDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const createRef = useRef<HTMLButtonElement>(null);
  const load = async () => {
    try {
      setEntries((await api<{ loops: Entry[] }>("/api/loops")).loops);
      setError("");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    api<{ loops: Entry[] }>("/api/loops")
      .then((response) => setEntries(response.loops))
      .catch((cause: unknown) => setError(String(cause)))
      .finally(() => setLoading(false));
  }, []);
  const create = async () => {
    try {
      const id = `loop-${crypto.randomUUID()}`;
      const draft = createLoopDraft(id, "Untitled loop");
      const result = await api<{ loop: LoopDefinition }>(`/api/loops/${id}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setSelected(result.loop);
      await load();
    } catch (cause) {
      setError(String(cause));
    }
  };
  if (selected)
    return (
      <LoopEditor
        key={`${selected.id}-${selected.version}`}
        initial={selected}
        project={project}
        agents={agents}
        onBack={() => {
          setSelected(null);
          void load();
          requestAnimationFrame(() => createRef.current?.focus());
        }}
        onPublished={async (loop) => {
          await load();
          onPublished?.(loop);
        }}
      />
    );
  return (
    <section className="mt-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Loops library</h2>
          <p className="text-sm text-muted-foreground">
            Saved drafts and immutable published versions for future runs.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onTemplate}>
            Use starter template
          </Button>
          <Button ref={createRef} onClick={() => void create()}>
            Create empty loop
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-8">Loading loops…</p>
      ) : entries.length ? (
        <div className="mt-6 grid gap-3">
          {entries.map((entry) => (
            <div key={entry.id} className="grid gap-3">
              {entry.draft && (
                <LoopCard loop={entry.draft} onEdit={() => setSelected(entry.draft)} />
              )}
              {entry.published && <LoopCard loop={entry.published} versions={entry.versions} />}
            </div>
          ))}
        </div>
      ) : (
        <Card className="mt-6 flex min-h-72 flex-col items-center justify-center border-dashed bg-white/60 p-8 text-center">
          <div className="text-4xl text-teal-700">∞</div>
          <h3 className="mt-3 text-xl font-semibold">No user loops yet</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Create an empty draft. Optional starter templates will be available when the template
            library is installed.
          </p>
          <Button className="mt-4" onClick={() => void create()}>
            Create empty loop
          </Button>
        </Card>
      )}
    </section>
  );
}
