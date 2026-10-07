import { useEffect, useState } from "react";
import { z } from "zod";
import type { LoopDefinition } from "../domain/loop.js";
import { loopSchema } from "../domain/loop.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { api } from "./project-api";

const reportSchema = z.object({
  issues: z.array(
    z.object({ field: z.string(), kind: z.enum(["unsupported", "lossy"]), message: z.string() }),
  ),
});
const previewSchema = z.object({
  relativePath: z.string(),
  revision: z.string(),
  direction: z.enum(["import", "export"]),
  conflicts: z.array(z.object({ path: z.string(), message: z.string() })),
  report: reportSchema,
  loop: loopSchema.optional(),
  content: z.string().optional(),
});
type Preview = z.infer<typeof previewSchema>;
type Direction = "import" | "export";
const formatsSchema = z.object({
  formats: z.array(
    z.object({
      format: z.string(),
      provider: z.string(),
      label: z.string(),
      directions: z.array(z.enum(["import", "export"])).min(1),
    }),
  ),
});

export const NativeTranslation = ({
  loop,
  apply,
  disabled,
}: {
  loop: LoopDefinition;
  apply: (action: (current: LoopDefinition) => LoopDefinition) => boolean;
  disabled: boolean;
}) => {
  const [direction, setDirection] = useState<Direction>("import");
  const [formats, setFormats] = useState<z.infer<typeof formatsSchema>["formats"]>([]);
  const [format, setFormat] = useState("");
  const [name, setName] = useState(loop.id);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewedLoop, setPreviewedLoop] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => {
    void api("/api/native/formats", formatsSchema.parse)
      .then((result) => {
        setFormats(result.formats);
        setFormat((current) => current || result.formats[0]?.format || "");
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : String(error)),
      );
  }, []);
  useEffect(() => {
    if (!format) return;
    void api(
      `/api/native/candidates?format=${encodeURIComponent(format)}`,
      z.object({ names: z.array(z.string()) }).parse,
    )
      .then((result) => setCandidates(result.names))
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : String(error)),
      );
  }, [format]);
  const selected = formats.find((item) => item.format === format);
  // Until formats load, keep Export enabled so the control does not flicker.
  const canExport = selected ? selected.directions.includes("export") : true;
  const request = (expectedRevision?: string) => ({ format, name, loop, expectedRevision });
  const previewChange = async () => {
    setWorking(true);
    setPreview(null);
    setMessage("");
    try {
      const result = await api(`/api/native/${direction}/preview`, previewSchema.parse, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request()),
      });
      setPreview(result);
      setPreviewedLoop(JSON.stringify(loop));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };
  const applyChange = async () => {
    if (!preview || JSON.stringify(loop) !== previewedLoop) {
      setMessage("Draft changed since preview. Preview again.");
      return;
    }
    setWorking(true);
    try {
      const result = await api(`/api/native/${direction}/apply`, previewSchema.parse, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request(preview.revision)),
      });
      const importedLoop = result.loop;
      if (direction === "import" && importedLoop && !apply(() => importedLoop)) {
        setMessage("Draft changed. Preview again.");
        return;
      }
      setMessage(
        direction === "import"
          ? "Imported into the draft. Save the draft to keep it."
          : `Exported ${result.relativePath}.`,
      );
      setPreview(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };
  return (
    <section
      className="border-b bg-slate-50 px-4 py-3"
      aria-label="Native configuration translation"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="native-format" className="text-sm">
          Native format
          <NativeSelect
            id="native-format"
            aria-label="Native format"
            className="mt-1"
            value={format}
            disabled={disabled || working}
            onChange={(event) => {
              const next = formats.find((item) => item.format === event.target.value);
              if (next && !next.directions.includes(direction)) setDirection("import");
              setFormat(event.target.value);
              setCandidates([]);
              setPreview(null);
            }}
          >
            {formats.map((item) => (
              <option key={item.format} value={item.format}>
                {item.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label htmlFor="translation-direction" className="text-sm">
          Direction
          <NativeSelect
            id="translation-direction"
            aria-label="Translation direction"
            className="mt-1"
            value={direction}
            disabled={disabled || working}
            onChange={(event) => {
              setDirection(event.target.value as Direction);
              setPreview(null);
            }}
          >
            <option value="import">Import</option>
            <option value="export" disabled={!canExport}>
              Export
            </option>
          </NativeSelect>
        </label>
        <label className="text-sm">
          Configuration name
          <Input
            className="mt-1 w-52"
            value={name}
            disabled={disabled || working}
            onChange={(event) => {
              setName(event.target.value);
              setPreview(null);
            }}
            list="native-configuration-names"
          />
          <datalist id="native-configuration-names">
            {candidates.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </datalist>
        </label>
        <Button
          variant="outline"
          disabled={disabled || working || !format}
          onClick={() => void previewChange()}
        >
          Preview
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Available formats are listed above. Other native formats are unsupported. Translation does
        not connect or run an agent.
      </p>
      {selected && !canExport && (
        <p className="mt-2 text-xs text-muted-foreground">{selected.label} is import-only.</p>
      )}
      {preview && (
        <div className="mt-3 rounded-md border bg-white p-3 text-sm">
          <p>
            Affected path: <code>{preview.relativePath}</code>
          </p>
          {preview.conflicts.map((conflict) => (
            <p key={conflict.path} className="text-red-700">
              Conflict: {conflict.message}
            </p>
          ))}
          {preview.report.issues.map((issue, index) => (
            <p key={`${issue.field}-${index}`}>
              {issue.kind}: {issue.field} — {issue.message}
            </p>
          ))}
          {preview.loop && <p>Imported draft step: {preview.loop.steps[0]?.name}</p>}
          {preview.loop && preview.loop.steps.length > 1 && (
            <>
              <p>
                Imported draft: {preview.loop.steps.length} steps
                {preview.loop.groups.length
                  ? `, ${preview.loop.groups.length} ${preview.loop.groups.length === 1 ? "group" : "groups"}`
                  : ""}
              </p>
              <ul aria-label="Imported steps">
                {preview.loop.steps.map((step) => (
                  <li key={step.id}>{step.name}</li>
                ))}
              </ul>
            </>
          )}
          {preview.content && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">
              {preview.content}
            </pre>
          )}
          <Button
            className="mt-2"
            disabled={
              disabled ||
              working ||
              preview.conflicts.length > 0 ||
              JSON.stringify(loop) !== previewedLoop
            }
            onClick={() => void applyChange()}
          >
            Apply {direction}
          </Button>
        </div>
      )}
      {message && <output className="mt-2 text-sm">{message}</output>}
    </section>
  );
};
