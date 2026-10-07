import { z } from "zod";
import type { EvidenceSummary } from "./acceptance.js";
import { runRecordSchema, type RunRecord } from "./run.js";

/** Append an event optionally scoped to a step attempt; the sequence continues the event log. */
export const appendScopedEvent = (
  record: RunRecord,
  scope: { stepId: string; attemptId: string } | undefined,
  type: "check" | "lifecycle",
  title: string,
  detail?: string,
  state?: string,
): RunRecord => {
  const sequence =
    Math.max(
      -1,
      ...record.evidence.filter((item) => item.kind === "event").map((item) => item.sequence),
    ) + 1;
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    evidence: [
      ...record.evidence,
      {
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        ...(scope ? { stepId: scope.stepId, attemptId: scope.attemptId } : {}),
        createdAt: new Date().toISOString(),
        kind: "event",
        type,
        title,
        ...(detail ? { detail } : {}),
        ...(state ? { state } : {}),
        sequence,
      },
    ],
  });
};

/** A run-level event (no step or attempt), used for setup, promotion and worktree lifecycle. */
export const appendRunEvent = (
  record: RunRecord,
  type: "check" | "lifecycle",
  title: string,
  detail?: string,
  state?: string,
): RunRecord => appendScopedEvent(record, undefined, type, title, detail, state);

/** Run-level setup evidence titles; the scheduler guard, stop cause and UI read only these. */
export const SETUP_STARTED = "Setup started";
export const SETUP_OUTPUT = "Setup output";
export const SETUP_COMPLETED = "Setup completed";
export const RUN_BRANCH_PREFIX = "code-factory/";

const PROTECTED_BRANCHES = new Set(["main", "master", "default", "production", "trunk", "develop"]);

export const promoteInputSchema = z.strictObject({
  branch: z
    .string()
    .trim()
    .min(1, "Enter a branch name.")
    .max(200, "Branch names are limited to 200 characters.")
    .superRefine((name, context) => {
      const fail = (message: string) => context.addIssue({ code: "custom", message });
      // oxlint-disable-next-line no-control-regex -- control characters are exactly what is rejected.
      if (/[\s\u0000-\u001f\u007f]/.test(name)) fail(`${name} is not a valid branch name.`);
      else if (name.startsWith("-")) fail(`${name} is not a valid branch name.`);
      else if (name.includes("@{") || name === "HEAD") fail(`${name} is not a valid branch name.`);
      else if (name.startsWith(RUN_BRANCH_PREFIX))
        fail(`${RUN_BRANCH_PREFIX} branches are reserved for run branches.`);
      else if (PROTECTED_BRANCHES.has(name.toLowerCase()))
        fail(`${name} is a protected branch name.`);
    }),
});

const commitSchema = z.strictObject({ sha: z.string(), subject: z.string() });
export const promotionSchema = z.strictObject({
  branch: z.string(),
  commit: z.string(),
  createdAt: z.string(),
});
export const runWorkspaceSchema = z.strictObject({
  kind: z.enum(["worktree", "clone", "none"]),
  path: z.string().nullable(),
  branch: z.string().nullable(),
  state: z.enum(["present", "missing", "removed"]),
  dirty: z.boolean().nullable(),
  removalBlocked: z.boolean().nullable(),
  commits: z.array(commitSchema).max(100),
  promotion: promotionSchema.nullable(),
  defaultBranchName: z.string(),
  setupConfigured: z.boolean(),
});
export type RunWorkspace = z.infer<typeof runWorkspaceSchema>;

export const removedWorktreeMessage = (branch: string) =>
  `This run's worktree was removed; branch ${branch} is kept.`;
export const missingWorktreeMessage = (path: string, branch: string) =>
  `This run's worktree is missing at ${path}; branch ${branch} is kept.`;
export const PROMOTION_NEEDS_ACCEPTANCE = "Accept the evidence before creating a ticket branch.";
export const PROMOTION_DIRTY =
  "The worktree has uncommitted changes, so the branch would not match the accepted candidate.";
export const REMOVAL_DIRTY =
  "The worktree has uncommitted changes. Commit or discard them in the worktree first.";

/** Single gate for "Create ticket branch"; the server's phase 1 returns the same strings in this order. */
export const promotionBlocker = (summary: EvidenceSummary, ws: RunWorkspace): string | null =>
  ws.promotion
    ? `This run already created branch ${ws.promotion.branch}.`
    : ws.kind !== "worktree"
      ? "Legacy runs have no run branch."
      : ws.state === "removed"
        ? removedWorktreeMessage(ws.branch ?? "")
        : ws.state === "missing"
          ? missingWorktreeMessage(ws.path ?? "", ws.branch ?? "")
          : summary.acceptance !== "accepted"
            ? PROMOTION_NEEDS_ACCEPTANCE
            : ws.dirty
              ? PROMOTION_DIRTY
              : null;

export const shortRunBranch = (runId: string): string =>
  `${RUN_BRANCH_PREFIX}${runId.replaceAll("-", "").slice(0, 8)}`;

export const defaultTicketBranch = (task: {
  ticket?: { id: string } | undefined;
  ticketId?: string | undefined;
}): string => task.ticket?.id ?? task.ticketId ?? "";

export const baselineCommitMessage = (
  ticketId: string,
  runId: string,
  at: Date,
): [subject: string, body: string] => [
  `${ticketId ? `${ticketId}: ` : ""}Code Factory baseline: uncommitted changes at ${at.toISOString()}`,
  `Code-Factory-Run: ${runId}`,
];

export const stepCommitMessage = (input: {
  ticketId: string;
  runId: string;
  stepId: string;
  stepName: string;
  attemptId: string;
  attemptNumber: number;
  implementationRound: number;
}): [subject: string, body: string] => [
  `${input.ticketId || "code-factory"}: ${input.stepName} (${input.stepId}) attempt ${input.attemptNumber}`,
  [
    `Code-Factory-Run: ${input.runId}`,
    `Code-Factory-Step: ${input.stepId}`,
    `Code-Factory-Attempt: ${input.attemptId}`,
    `Code-Factory-Round: ${input.implementationRound}`,
  ].join("\n"),
];
