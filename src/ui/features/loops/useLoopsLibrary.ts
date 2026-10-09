import { useEffect, useRef, useState } from "react";
import { createLoopDraft, type LoopDefinition } from "../../../domain/loop.js";
import { exportPortableLoop, inspectPortableLoop } from "../../../domain/loop-portable.js";
import { createStarterDraft, type StarterId } from "../../../domain/starter-templates.js";
import { api, loopEntriesResponseSchema, loopResponseSchema } from "../../shared/project-api";

export type LoopEntry = {
  id: string;
  draft: LoopDefinition | null;
  published: LoopDefinition | null;
  versions: number[];
};

/** Loads the project's loops and owns the draft, starter, import and export actions. */
export const useLoopsLibrary = (onPublished?: (loop: LoopDefinition) => void) => {
  const [entries, setEntries] = useState<LoopEntry[]>([]);
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
  const changeImportText = (text: string) => {
    setImportText(text);
    setPreview(null);
    setImportErrors([]);
  };
  const openImport = () => {
    setChooser(false);
    changeImportText("");
    const details = document.querySelector<HTMLDetailsElement>("#loop-import");
    if (details) {
      details.open = true;
      details.scrollIntoView?.();
    }
  };
  const previewImport = () => {
    const result = inspectPortableLoop(importText, `loop-${crypto.randomUUID()}`);
    setImportErrors(result.errors);
    setPreview(result.loop);
  };
  const confirmImport = () => {
    if (!preview) return;
    void persistDraft(preview).then((saved) => {
      if (saved) setPreview(null);
    });
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
  const closeEditor = () => {
    setSelected(null);
    void load();
    requestAnimationFrame(() => createRef.current?.focus());
  };
  const editorPublished = async (loop: LoopDefinition) => {
    await load();
    onPublished?.(loop);
  };
  return {
    entries,
    selected,
    setSelected,
    loading,
    error,
    chooser,
    toggleChooser: () => setChooser((current) => !current),
    importText,
    importErrors,
    preview,
    createRef,
    create,
    chooseStarter,
    changeImportText,
    openImport,
    previewImport,
    confirmImport,
    exportLoop,
    closeEditor,
    editorPublished,
  };
};
