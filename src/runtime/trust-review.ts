import type { LoopDefinition } from "../domain/loop.js";
import type { ProjectTrust, TrustReview } from "../domain/trust.js";
import { readProjectConfig } from "./project.js";
import { listPublishedLoops, listRuns } from "./storage.js";
import { readProjectTrust } from "./trust.js";

/**
 * Runs whose commands a trusted project can still reach: Execute starts or resumes the unfinished
 * ones, and Retry restarts a failed run or a blocked review (`retryBlocker` in the run domain).
 */
const REACHABLE = new Set(["pending", "running", "waiting-input", "paused", "failed", "blocked"]);
const INTERRUPTED = new Set(["running", "waiting-input", "paused"]);

const unique = <T>(items: T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

/**
 * Everything the project's own `.code-factory` files would make Code Factory run on this machine,
 * so the trust decision is made with the commands in view. Read-only; launches nothing.
 */
export const reviewProjectTrust = async (project: string): Promise<TrustReview> => {
  const [config, loops, runs] = await Promise.all([
    readProjectConfig(project),
    listPublishedLoops(project),
    listRuns(project),
  ]);
  const reachable = runs.filter((run) => REACHABLE.has(run.status));
  const sources: LoopDefinition[] = [...loops, ...reachable.map((run) => run.snapshot.loop)];
  const checkCommands = unique(
    sources.flatMap((loop) =>
      loop.steps
        .filter((step) => step.kind === "check")
        .map((step) => ({ loop: loop.name, step: step.name, command: step.instruction })),
    ),
    (item) => `${item.loop}\u0000${item.step}\u0000${item.command}`,
  );
  const runSetupCommands = unique(
    reachable.flatMap((run) =>
      run.snapshot.setupCommand
        ? [{ loop: run.snapshot.loop.name, command: run.snapshot.setupCommand }]
        : [],
    ),
    (item) => [item.loop, ...item.command].join("\u0000"),
  );
  return {
    setupCommand: config?.setupCommand ?? null,
    runSetupCommands,
    customExecutable: config?.customAgent?.executable ?? null,
    checkCommands,
    interruptedRuns: reachable.filter((run) => INTERRUPTED.has(run.status)).length,
  };
};

export const describeProjectTrust = async (project: string): Promise<ProjectTrust> => {
  const [entry, review] = await Promise.all([
    readProjectTrust(project),
    reviewProjectTrust(project),
  ]);
  return {
    trusted: Boolean(entry),
    trustedAt: entry?.trustedAt ?? null,
    toolGrants: entry?.toolGrants ?? {},
    review,
  };
};
