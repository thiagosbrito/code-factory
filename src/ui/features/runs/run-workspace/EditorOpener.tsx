import { useId, useRef } from "react";
import { Button } from "@/shared/components/button";
import { NativeSelect } from "@/shared/components/native-select";
import type { useCopyAnnouncer } from "../../../shared/clipboard";
import { EDITORS, openInEditorCommand, type EditorCli } from "./workspace-editor";

type Copy = ReturnType<typeof useCopyAnnouncer>["copy"];

/** Pick an editor and copy the command that opens the workspace in it. */
export const EditorOpener = ({
  editor,
  path,
  copiedKey,
  copy,
  onEditorChange,
}: {
  editor: EditorCli;
  path: string;
  copiedKey: string | null;
  copy: Copy;
  onEditorChange: (cli: EditorCli) => void;
}) => {
  const editorId = useId();
  const commandRef = useRef<HTMLElement>(null);
  const command = openInEditorCommand(editor, path);
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
      <div>
        <label htmlFor={editorId} className="block text-xs font-medium">
          Editor
        </label>
        <NativeSelect
          id={editorId}
          className="w-auto min-w-32"
          value={editor}
          onChange={(event) => {
            const next = EDITORS.find((item) => item.cli === event.target.value)?.cli;
            if (next) onEditorChange(next);
          }}
        >
          {EDITORS.map((item) => (
            <option key={item.cli} value={item.cli}>
              {item.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void copy("open", "Open command", command, commandRef.current)}
      >
        {copiedKey === "open" ? "Copied" : "Copy open command"}
      </Button>
      <code ref={commandRef} className="break-all text-xs text-muted-foreground">
        {command}
      </code>
    </div>
  );
};
