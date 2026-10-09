import { useEffect, useRef, useState } from "react";
import type { AgentConnection } from "../../../adapters/contract.js";
import { createLoopDraft, type LoopDefinition } from "../../../domain/loop.js";
import { exportPortableLoop, inspectPortableLoop } from "../../../domain/loop-portable.js";
import {
  createStarterDraft,
  starterTemplates,
  type StarterId,
} from "../../../domain/starter-templates.js";
import { Button } from "@/shared/components/button";
import { Card } from "@/shared/components/card";
import { Textarea } from "@/shared/components/textarea";
import { api, type ProjectResponse } from "../../shared/project-api";
import { loopEntriesResponseSchema, loopResponseSchema } from "../../shared/project-api";
import { LoopEditor } from "./LoopEditor";

type Entry = {
  id: string;
  draft: LoopDefinition | null;
  published: LoopDefinition | null;
  versions: number[];
};

const LoopCard = ({
  loop,
  versions,
  onEdit,
  onExport,
}: {
  loop: LoopDefinition;
  versions?: number[];
  onEdit?: () => void;
  onExport?: () => void;
}) => {
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
      <div className="flex gap-2">
        {onEdit && (
          <Button variant="outline" onClick={onEdit}>
            Edit draft
          </Button>
        )}
        {onExport && (
          <Button variant="outline" onClick={onExport}>
            Export JSON
          </Button>
        )}
      </div>
    </Card>
  );
};
export const Loops = ({
  project,
  agents,
  onPublished,
}: {
  project: ProjectResponse;
  agents: AgentConnection[];
  onPublished?: (loop: LoopDefinition) => void;
}) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<LoopDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chooser, setChooser] = useState(false);
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<LoopDefinition | null>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const load = async () => {
    try {
      setEntries((await api("/api/loops", loopEntriesResponseSchema.parse)).loops);
      setError("");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    api("/api/loops", loopEntriesResponseSchema.parse)
      .then((response) => setEntries(response.loops))
      .catch((cause: unknown) => setError(String(cause)))
      .finally(() => setLoading(false));
  }, []);
  const persistDraft = async (draft: LoopDefinition) => {
    try {
      const result = await api(`/api/loops/${draft.id}/draft`, loopResponseSchema.parse, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setSelected(result.loop);
      await load();
      return true;
    } catch (cause) {
      setError(String(cause));
      return false;
    }
  };
  const create = async () => {
    await persistDraft(createLoopDraft(`loop-${crypto.randomUUID()}`, "Untitled loop"));
  };
  const chooseStarter = async (starter: StarterId) => {
    if (await persistDraft(createStarterDraft(starter, `loop-${crypto.randomUUID()}`)))
      setChooser(false);
  };
  const previewImport = () => {
    const result = inspectPortableLoop(importText, `loop-${crypto.randomUUID()}`);
    setImportErrors(result.errors);
    setPreview(result.loop);
  };
  const exportLoop = (loop: LoopDefinition) => {
    const url = URL.createObjectURL(
      new Blob([exportPortableLoop(loop)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${loop.id}-v${loop.version}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
          <Button variant="outline" onClick={() => setChooser((current) => !current)}>
            Use starter template
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setChooser(false);
              setImportText("");
              setImportErrors([]);
              setPreview(null);
              const details = document.querySelector<HTMLDetailsElement>("#loop-import");
              if (details) {
                details.open = true;
                details.scrollIntoView?.();
              }
            }}
          >
            Import JSON
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
      {chooser && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Starter templates">
          {starterTemplates.map((starter) => (
            <Card key={starter.id} className="p-4">
              <h3 className="font-semibold">{starter.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{starter.description}</p>
              <Button className="mt-3" onClick={() => void chooseStarter(starter.id)}>
                Create draft
              </Button>
            </Card>
          ))}
        </div>
      )}
      <details id="loop-import" className="mt-4 rounded-lg border bg-white p-4">
        <summary className="cursor-pointer font-medium">Import canonical loop JSON</summary>
        <label htmlFor="loop-json" className="mt-3 block text-sm">
          Paste a portable loop document
        </label>
        <Textarea
          id="loop-json"
          className="mt-1 min-h-36 font-mono text-xs"
          value={importText}
          onChange={(event) => {
            setImportText(event.target.value);
            setPreview(null);
            setImportErrors([]);
          }}
        />
        <div className="flex gap-2">
          <Button variant="outline" onClick={previewImport}>
            Validate import
          </Button>
          {preview && (
            <Button
              onClick={() => {
                void persistDraft(preview).then((saved) => {
                  if (saved) setPreview(null);
                });
              }}
            >
              Confirm import: {preview.name}
            </Button>
          )}
        </div>
        {importErrors.length > 0 && (
          <ul role="alert" className="mt-2 list-disc pl-5 text-sm text-red-700">
            {importErrors.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        )}
        {preview && (
          <p className="mt-2 text-sm">
            Valid draft with {preview.steps.length} steps. Confirm to save it in this project.
          </p>
        )}
      </details>
      {loading ? (
        <p className="mt-8">Loading loops…</p>
      ) : entries.length ? (
        <div className="mt-6 grid gap-3">
          {entries.map((entry) => (
            <div key={entry.id} className="grid gap-3">
              {entry.draft && (
                <LoopCard
                  loop={entry.draft}
                  onEdit={() => setSelected(entry.draft)}
                  onExport={() => entry.draft && exportLoop(entry.draft)}
                />
              )}
              {entry.published && (
                <LoopCard
                  loop={entry.published}
                  versions={entry.versions}
                  onExport={() => entry.published && exportLoop(entry.published)}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <Card className="mt-6 flex min-h-72 flex-col items-center justify-center border-dashed bg-white/60 p-8 text-center">
          <div className="text-4xl text-teal-700">∞</div>
          <h3 className="mt-3 text-xl font-semibold">No user loops yet</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Create an empty draft, choose a starter, or import a canonical loop document.
          </p>
          <Button className="mt-4" onClick={() => void create()}>
            Create empty loop
          </Button>
        </Card>
      )}
    </section>
  );
};
