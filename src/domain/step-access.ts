import type { LoopDefinition } from "./loop.js";

type LoopStep = LoopDefinition["steps"][number];

/**
 * Portable project-access policy for a step, derived from its stage. There is deliberately no
 * stored field: loops published and runs snapshotted before this policy parse unchanged, and the
 * stage already says what the step is for.
 *
 * - `evidence`, `planning` and `review` agent steps only read the project (they report findings,
 *   plans and verdicts as output); a review additionally judges a frozen candidate.
 * - `implementation`, `validation` and steps without a stage keep write access, as before. A
 *   stage-less step is a deliberate legacy default: guessing "read-only" would silently break
 *   existing loops that never declared a stage.
 * - Checks are commands, not agent turns; the runtime separately verifies they change nothing.
 *
 * For persisted data this applies retroactively: an old snapshot's evidence or planning step is
 * now read-only on its next execution, which is the intended meaning of those stages.
 */
export const READ_ONLY_AGENT_STAGES = ["evidence", "planning", "review"] as const;

/** True when an agent step must run without write or shell permissions. */
export const isReadOnlyAgentStep = (step: Pick<LoopStep, "kind" | "stage">): boolean =>
  step.kind === "agent" &&
  step.stage !== undefined &&
  (READ_ONLY_AGENT_STAGES as readonly string[]).includes(step.stage);

/** True when a successful step may leave changes that Code Factory commits to the run branch. */
export const stepWritesProject = (step: Pick<LoopStep, "kind" | "stage">): boolean =>
  step.kind === "agent" && !isReadOnlyAgentStep(step);

/** Analytical steps share the read-only policy but, unlike reviews, run on the live checkout. */
export const isAnalyticalStep = (step: Pick<LoopStep, "kind" | "stage">): boolean =>
  isReadOnlyAgentStep(step) && step.stage !== "review";

/** Name used in violation messages and evidence for a read-only step. */
export const readOnlyRole = (step: Pick<LoopStep, "kind" | "stage">): ReadOnlyRole =>
  step.kind === "check"
    ? "Check"
    : step.stage === "evidence"
      ? "Evidence step"
      : step.stage === "planning"
        ? "Planning step"
        : "Reviewer";

export type ReadOnlyRole = "Reviewer" | "Check" | "Evidence step" | "Planning step";
