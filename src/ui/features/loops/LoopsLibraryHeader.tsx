import type { RefObject } from "react";
import { Button } from "@/shared/components/button";

export const LoopsLibraryHeader = ({
  createRef,
  onToggleStarters,
  onImport,
  onCreate,
}: {
  createRef: RefObject<HTMLButtonElement | null>;
  onToggleStarters: () => void;
  onImport: () => void;
  onCreate: () => void;
}) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 className="text-lg font-semibold">Loops library</h2>
      <p className="text-sm text-muted-foreground">
        Saved drafts and immutable published versions for future runs.
      </p>
    </div>
    <div className="flex gap-2">
      <Button variant="outline" onClick={onToggleStarters}>
        Use starter template
      </Button>
      <Button variant="outline" onClick={onImport}>
        Import JSON
      </Button>
      <Button ref={createRef} onClick={onCreate}>
        Create empty loop
      </Button>
    </div>
  </div>
);
