import type { RefObject } from "react";
import { Button } from "@/shared/components/button";
import type { useCopyAnnouncer } from "../../../shared/clipboard";

type Copy = ReturnType<typeof useCopyAnnouncer>["copy"];

/** The run branch and the project or worktree path, each with a copy button. */
export const WorkspaceLocation = ({
  branch,
  path,
  inProject,
  copiedKey,
  copy,
  branchRef,
  pathRef,
  copyBranchRef,
}: {
  branch: string;
  path: string;
  inProject: boolean;
  copiedKey: string | null;
  copy: Copy;
  branchRef: RefObject<HTMLElement | null>;
  pathRef: RefObject<HTMLElement | null>;
  copyBranchRef: RefObject<HTMLButtonElement | null>;
}) => (
  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-center">
    <dt className="font-medium">Branch</dt>
    <dd className="break-all font-mono text-xs">
      <code ref={branchRef}>{branch}</code>
    </dd>
    <dd>
      <Button
        ref={copyBranchRef}
        size="sm"
        variant="outline"
        onClick={() => void copy("branch", "Branch name", branch, branchRef.current)}
      >
        {copiedKey === "branch" ? "Copied" : "Copy branch"}
      </Button>
    </dd>
    <dt className="font-medium">{inProject ? "Project" : "Worktree"}</dt>
    <dd className="break-all font-mono text-xs">
      <code ref={pathRef}>{path}</code>
    </dd>
    <dd>
      <Button
        size="sm"
        variant="outline"
        disabled={!path}
        onClick={() =>
          void copy("path", inProject ? "Project path" : "Worktree path", path, pathRef.current)
        }
      >
        {copiedKey === "path" ? "Copied" : "Copy path"}
      </Button>
    </dd>
  </dl>
);
