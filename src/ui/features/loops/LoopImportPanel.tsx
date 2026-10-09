import type { LoopDefinition } from "../../../domain/loop.js";
import { Button } from "@/shared/components/button";
import { Textarea } from "@/shared/components/textarea";
import { LoopErrorList } from "./LoopErrorList";

/** Paste, validate and confirm a portable loop document. */
export const LoopImportPanel = ({
  text,
  errors,
  preview,
  onTextChange,
  onValidate,
  onConfirm,
}: {
  text: string;
  errors: string[];
  preview: LoopDefinition | null;
  onTextChange: (text: string) => void;
  onValidate: () => void;
  onConfirm: () => void;
}) => (
  <details id="loop-import" className="mt-4 rounded-lg border bg-white p-4">
    <summary className="cursor-pointer font-medium">Import canonical loop JSON</summary>
    <label htmlFor="loop-json" className="mt-3 block text-sm">
      Paste a portable loop document
    </label>
    <Textarea
      id="loop-json"
      className="mt-1 min-h-36 font-mono text-xs"
      value={text}
      onChange={(event) => onTextChange(event.target.value)}
    />
    <div className="flex gap-2">
      <Button variant="outline" onClick={onValidate}>
        Validate import
      </Button>
      {preview && <Button onClick={onConfirm}>Confirm import: {preview.name}</Button>}
    </div>
    <LoopErrorList errors={errors} />
    {preview && (
      <p className="mt-2 text-sm">
        Valid draft with {preview.steps.length} steps. Confirm to save it in this project.
      </p>
    )}
  </details>
);
