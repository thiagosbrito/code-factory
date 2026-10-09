import type { RunWorkspace } from "../../../../domain/run-branch.js";

export const WorkspaceCommits = ({ commits }: { commits: RunWorkspace["commits"] }) => (
  <details className="mt-3 text-sm">
    <summary className="cursor-pointer">Commits ({commits.length})</summary>
    {commits.length ? (
      <ol className="mt-2 space-y-1">
        {commits.map((item) => (
          <li key={item.sha} className="flex gap-2">
            <code className="text-xs">{item.sha.slice(0, 7)}</code>
            <span>{item.subject}</span>
          </li>
        ))}
      </ol>
    ) : (
      <p className="mt-2 text-muted-foreground">No commits on the run branch yet.</p>
    )}
  </details>
);
