import type { LoopDefinition } from "../domain/loop.js";
import type { ProjectTrust, TrustReview } from "../domain/trust.js";
import { readProjectConfig } from "./project.js";
import { listPublishedLoops, listRuns } from "./storage.js";
import { readProjectTrust } from "./trust.js";

const UNFINISHED = new Set(["pending", "running", "waiting-input", "paused"]);
const INTERRUPTED = new Set(["running", "waiting-input", "paused"]);

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
  const unfinished = runs.filter((run) => UNFINISHED.has(run.status));
  const sources: LoopDefinition[] = [...loops, ...unfinished.map((run) => run.snapshot.loop)];
  const seen = new Set<string>();
  const checkCommands = sources.flatMap((loop) =>
    loop.steps
      .filter((step) => step.kind === "check")
      .map((step) => ({ loop: loop.name, step: step.name, command: step.instruction }))
      .filter((item) => {
        const key = `${item.loop}\u0000${item.step}\u0000${item.command}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
  );
  return {
    setupCommand: config?.setupCommand ?? null,
    customExecutable: config?.customAgent?.executable ?? null,
    checkCommands,
    interruptedRuns: unfinished.filter((run) => INTERRUPTED.has(run.status)).length,
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
