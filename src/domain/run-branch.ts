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

/** Shared Git branch-name rules; Git's own check-ref-format still runs in the runtime. */
const branchName = (options: { allowRunPrefix: boolean }) =>
  z
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
      else if (!options.allowRunPrefix && name.startsWith(RUN_BRANCH_PREFIX))
        fail(`${RUN_BRANCH_PREFIX} branches are reserved for run branches.`);
      else if (PROTECTED_BRANCHES.has(name.toLowerCase()))
        fail(`${name} is a protected branch name.`);
    });

/** The branch a new run creates in the project; `code-factory/<id>` is its default without a ticket. */
export const runBranchNameSchema = branchName({ allowRunPrefix: true });
export const promoteInputSchema = z.strictObject({ branch: branchName({ allowRunPrefix: false }) });

const commitSchema = z.strictObject({ sha: z.string(), subject: z.string() });
export const promotionSchema = z.strictObject({
  branch: z.string(),
  commit: z.string(),
  createdAt: z.string(),
});
/** Where the project checkout is now, relative to an in-project run's branch. */
export const projectCheckoutSchema = z.strictObject({
  current: z.string().nullable(),
  onRunBranch: z.boolean(),
  previousBranch: z.string().nullable(),
  previousRevision: z.string(),
  returnBlocker: z.string().nullable(),
});
export type ProjectCheckout = z.infer<typeof projectCheckoutSchema>;
export const runWorkspaceSchema = z.strictObject({
  kind: z.enum(["project", "worktree", "clone", "none"]),
  path: z.string().nullable(),
  branch: z.string().nullable(),
  state: z.enum(["present", "missing", "removed"]),
  dirty: z.boolean().nullable(),
  removalBlocked: z.boolean().nullable(),
  commits: z.array(commitSchema).max(100),
  promotion: promotionSchema.nullable(),
  defaultBranchName: z.string(),
  setupConfigured: z.boolean(),
  checkout: projectCheckoutSchema.nullable(),
});
export type RunWorkspace = z.infer<typeof runWorkspaceSchema>;

export const removedWorktreeMessage = (branch: string) =>
  `This run's worktree was removed; branch ${branch} is kept.`;
export const missingWorktreeMessage = (path: string, branch: string) =>
  `This run's worktree is missing at ${path}; branch ${branch} is kept.`;
/** Marks a run that works in the project folder itself (no worktree or clone). */
export const PROJECT_WORKSPACE = ".";
export const isProjectRun = (baseline: { workspace?: string | undefined }): boolean =>
  baseline.workspace === PROJECT_WORKSPACE;
export const PROJECT_DIRTY =
  "The project has uncommitted changes. Commit or stash them yourself, then start the run again; Code Factory never stashes, resets or cleans your files.";
export const checkoutMovedMessage = (branch: string, current: string | null): string =>
  `The project is on ${current ? `branch ${current}` : "a detached HEAD"}, not on run branch ${branch}. Switch back with \`git switch ${branch}\` to continue this run.`;
export const RETURN_DIRTY =
  "The project has uncommitted changes. Commit or discard them before switching branches; Code Factory never stashes or resets your files.";
export const PROMOTION_NEEDS_ACCEPTANCE = "Accept the evidence before creating a ticket branch.";
export const PROMOTION_DIRTY =
  "The run's files have uncommitted changes, so the branch would not match the accepted candidate.";
export const REMOVAL_DIRTY =
  "The worktree has uncommitted changes. Commit or discard them in the worktree first.";

/** Single gate for "Create ticket branch"; the server's phase 1 returns the same strings in this order. */
export const promotionBlocker = (summary: EvidenceSummary, ws: RunWorkspace): string | null =>
  ws.promotion
    ? `This run already created branch ${ws.promotion.branch}.`
    : ws.kind !== "worktree" && ws.kind !== "project"
      ? "Legacy runs have no run branch."
      : ws.kind === "project" && ws.branch === ws.defaultBranchName
        ? `This run already works on branch ${ws.branch}.`
        : ws.kind === "project" && !ws.checkout?.onRunBranch
          ? checkoutMovedMessage(ws.branch ?? "", ws.checkout?.current ?? null)
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

/** Paths whose content, mode or presence differs between two per-path file hash maps. */
export const changedFiles = (
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] =>
  [
    ...[...after].flatMap(([path, hash]) =>
      before.has(path)
        ? before.get(path) === hash
          ? []
          : [`modified ${path}`]
        : [`added ${path}`],
    ),
    ...[...before.keys()].filter((path) => !after.has(path)).map((path) => `deleted ${path}`),
  ].sort((a, b) => a.slice(a.indexOf(" ") + 1).localeCompare(b.slice(b.indexOf(" ") + 1)));

/** Evidence titles for in-project failures Code Factory detects itself, outside the agent's output. */
export const READ_ONLY_VIOLATION = "read-only-violation";
export const CHECKOUT_MOVED = "checkout-moved";
export const READ_ONLY_LEFTOVERS =
  "A reviewer or check changed project files earlier in this run, and the project still has uncommitted changes. Review, commit or discard them yourself before continuing, so a later step does not commit them as its own.";

/** A read-only step (review or check) that changed project files fails with this summary. */
export const readOnlyViolation = (role: "Reviewer" | "Check", changes: string[]): string =>
  `${role} changed project files, so its result does not describe the committed candidate. Nothing was reverted; review or discard these changes yourself:\n${changes
    .slice(0, 50)
    .join("\n")}${changes.length > 50 ? `\n… and ${changes.length - 50} more` : ""}`;
