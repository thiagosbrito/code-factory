import type { ReactNode, RefObject } from "react";
import { Button } from "@/shared/components/button";
import { BranchIcon, DescriptionIcon, EvidenceIcon } from "../../../shared/icons";

export type RunPanel = "description" | "branch" | "evidence";
const RUN_PANELS: { id: RunPanel; label: string; icon: ReactNode }[] = [
  { id: "description", label: "Description", icon: <DescriptionIcon /> },
  { id: "branch", label: "Run branch", icon: <BranchIcon /> },
  { id: "evidence", label: "Final evidence summary", icon: <EvidenceIcon /> },
];

/** The icon buttons that open the description, branch and evidence dialogs. */
export const RunDetailNav = ({
  hasWorkspace,
  acceptable,
  accepted,
  triggers,
  onOpen,
}: {
  hasWorkspace: boolean;
  /** Validation passed and acceptance is still pending. */
  acceptable: boolean;
  accepted: boolean;
  triggers: RefObject<Partial<Record<RunPanel, HTMLButtonElement | null>>>;
  onOpen: (panel: RunPanel) => void;
}) => (
  <nav aria-label="Run details" className="flex items-center gap-1">
    {RUN_PANELS.filter((item) => item.id !== "branch" || hasWorkspace).map((item) => (
      <Button
        key={item.id}
        ref={(element) => {
          triggers.current[item.id] = element;
        }}
        variant="ghost"
        size="sm"
        aria-label={item.label}
        title={item.label}
        className="relative h-9 w-9 p-0"
        onClick={() => onOpen(item.id)}
      >
        {item.icon}
        {item.id === "evidence" && (acceptable || accepted) && (
          <span
            aria-hidden="true"
            className={`absolute right-1 top-1 h-2 w-2 rounded-full ${acceptable ? "bg-amber-500" : "bg-emerald-600"}`}
          />
        )}
      </Button>
    ))}
  </nav>
);
