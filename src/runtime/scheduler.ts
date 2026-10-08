import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
  CancellationUnconfirmedError,
  type AgentAdapter,
  type AdapterEvent,
  type StepExecutionInput,
} from "../adapters/contract.js";
import {
  attachAttemptSession,
  runRecordSchema,
  setAttemptControlState,
  type RunRecord,
} from "../domain/run.js";
import {
  claimStep,
  completeStep,
  continueRepeat,
  hashInputs,
  readySteps,
  prepareStepRetry,
  settleRun,
  skipInactive,
  type StepResult,
} from "../domain/scheduler.js";
import {
  extractRetrievedIssue,
  isIssueBlockedOutput,
  issueBlockedSentinel,
  retrievedIssueEnd,
  retrievedIssueStart,
} from "../domain/ticket.js";
import { formatCommandLine } from "../domain/project.js";
import {
  appendRunEvent,
  appendScopedEvent,
  changedFiles,
  CHECKOUT_MOVED,
  checkoutMovedMessage,
  READ_ONLY_VIOLATION,
  readOnlyViolation,
  SETUP_COMPLETED,
  SETUP_OUTPUT,
  SETUP_STARTED,
} from "../domain/run-branch.js";
import { describeToolGrant, TOOL_PERMISSION } from "../domain/tool-grant.js";
import { mutateRun, readRun } from "./storage.js";
import { acknowledgeGuidance, deliverQueuedGuidance, expireQueuedGuidance } from "./guidance.js";
import { snapshotFileDiffs } from "./inspection.js";
import { ProjectError } from "./project.js";
import {
  commitStepChanges,
  createReviewCopy,
  listRunChangedFiles,
  listUncommittedPaths,
} from "./run-branch.js";
import { resolveToolGrant } from "./tool-grant.js";
import { ensureChangedFilesGate } from "./gates.js";
import { CHANGED_FILES_GATE_PATH } from "../domain/gates.js";
import {
  currentBranch,
  fileDigest,
  gitTreeState,
  resolveRunWorkspace,
  type ResolvedWorkspace,
} from "./workspace.js";

type FileSnapshot = Awaited<ReturnType<typeof snapshotFileDiffs>>[number];

const diffLineCounts = (diff: string) =>
  diff.split("\n").reduce(
    (counts, line) => ({
      additions: counts.additions + (line.startsWith("+") && !line.startsWith("+++ ") ? 1 : 0),
      deletions: counts.deletions + (line.startsWith("-") && !line.startsWith("--- ") ? 1 : 0),
    }),
    { additions: 0, deletions: 0 },
  );

const appendFileReceipts = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  before: FileSnapshot[],
  after: FileSnapshot[],
  inputReceiptIds: string[],
  source: "agent" | "check",
  stale: boolean,
): RunRecord => {
  const candidateId = record.steps.find((item) => item.stepId === stepId)?.candidateId;
  if (!candidateId) return record;
  const previous = new Map(before.map((item) => [item.change.path, item.digest]));
  const produced = after.filter((item) => previous.get(item.change.path) !== item.digest);
  if (!produced.length) return record;
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    evidence: [
      ...record.evidence,
      ...produced.map(({ change, diff, digest }) => ({
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        stepId,
        attemptId,
        createdAt: new Date().toISOString(),
        kind: "file" as const,
        path: change.path,
        change: change.change,
        ...(change.previousPath ? { previousPath: change.previousPath } : {}),
        ...diffLineCounts(diff),
        diffDigest: digest,
        provenance: {
          source,
          baselineId: record.snapshot.baseline.id,
          candidateId,
          inputReceiptIds,
        },
        freshness: {
          state: stale ? ("superseded" as const) : ("current" as const),
          checkedAgainstCandidateId: candidateId,
        },
      })),
    ],
  });
};

type Resolver = (provider: string) => AgentAdapter | null;
const SETUP_TIMEOUT_MS = 900_000;
const FINISHED_RUN = new Set([
  "succeeded",
  "failed",
  "canceled",
  "rejected",
  "blocked",
  "unavailable",
]);
const isActiveStatus = (status: string): boolean =>
  status === "running" || status === "waiting-input" || status === "paused";
const active = new Map<
  string,
  { work: Promise<RunRecord>; controller: AbortController; retry?: string }
>();

export { fileDigest };

export const workspaceFor = async (project: string, record: RunRecord): Promise<string> =>
  (await resolveRunWorkspace(project, record, { legacy: "prefix" })).path;

const issueLookupInstruction = (ticketId: string): string =>
  [
    `Issue ${ticketId} has not been retrieved by Code Factory. Before doing this step, use the issue tracker MCP available in your selected AI tool (for example Jira or Linear) to read the issue, including its title, description and acceptance criteria. Use those requirements for this step.`,
    `Include the retrieved details in your output between these exact lines so later steps receive them:`,
    retrievedIssueStart(ticketId),
    "Title: <title>",
    "Description: <description>",
    "Acceptance criteria: <acceptance criteria>",
    retrievedIssueEnd,
    `If the issue tracker MCP is unavailable or the issue cannot be read, begin your output with "${issueBlockedSentinel(ticketId)}" and do not make changes or claim the task is complete.`,
  ].join("\n");

/**
 * Agent turns are isolated, so the issue is read once by an entry step (no incoming dependency)
 * and Code Factory carries the delimited details from that step's latest succeeded completion
 * evidence into every later step, round, and retry instead of asking agents to fetch it again.
 */
const issueContext = (record: RunRecord, stepId: string, ticketId: string): string => {
  const { loop } = record.snapshot;
  const entryStepIds = new Set(
    loop.steps
      .filter((step) => !loop.dependencies.some((edge) => edge.to === step.id))
      .map((step) => step.id),
  );
  const succeededEntryAttempts = new Set(
    record.steps
      .filter((step) => entryStepIds.has(step.stepId))
      .flatMap((step) => step.attempts)
      .filter((attempt) => attempt.status === "succeeded")
      .map((attempt) => attempt.id),
  );
  const retrieved = [...record.evidence]
    .reverse()
    .map((item) =>
      item.kind === "event" &&
      item.title === "completed" &&
      item.attemptId &&
      succeededEntryAttempts.has(item.attemptId)
        ? extractRetrievedIssue(item.detail, ticketId)
        : undefined,
    )
    .find(Boolean);
  if (retrieved)
    return `Issue ${ticketId} was retrieved earlier in this run. Use these details as the requirements and do not fetch the issue again:\n${retrieved}`;
  const step = record.steps.find((item) => item.stepId === stepId);
  if (entryStepIds.has(stepId) && !step?.attempts.some((item) => item.status === "succeeded"))
    return issueLookupInstruction(ticketId);
  return `Issue ${ticketId} details were not captured by the first step. Do not fetch the issue again; work from the task and inputs below.`;
};

/** Agent steps outside review in a project or worktree run get one Code Factory commit per success. */
const writesRunBranch = (record: RunRecord, stepId: string): boolean => {
  const definition = record.snapshot.loop.steps.find((step) => step.id === stepId);
  return (
    Boolean(record.snapshot.baseline.branch) &&
    definition?.kind === "agent" &&
    definition.stage !== "review"
  );
};

/** Changed-file facts for in-project runs, given to check commands as environment variables. */
const checkEnvironment = (base: string, files: string[]): NodeJS.ProcessEnv => ({
  ...process.env,
  CODE_FACTORY_BASE_REVISION: base,
  // Newline-separated, so `$CODE_FACTORY_CHANGED_FILES` expands to one argument per file in sh.
  CODE_FACTORY_CHANGED_FILES: files.join("\n"),
});

/** The same facts for agent steps, so they can scope their own checks to this run's changes. */
const changedFilesContext = (base: string, files: string[]): string =>
  [
    files.length
      ? `This run started at commit ${base}. Files changed by this run so far (${files.length}):\n${files.slice(0, 200).join("\n")}${files.length > 200 ? `\n… and ${files.length - 200} more (git diff --name-only ${base})` : ""}`
      : `This run started at commit ${base}. No files have changed in this run yet.`,
    `The changed-files gates run as \`node ${CHANGED_FILES_GATE_PATH} <lint|types|coverage> --base ${base}\` from the project root.`,
  ].join("\n");

/** Every step upstream of `stepId` in the declared dependency graph. */
const ancestorsOf = (record: RunRecord, stepId: string): Set<string> => {
  const found = new Set<string>();
  const pending = [stepId];
  for (let current = pending.pop(); current !== undefined; current = pending.pop())
    for (const edge of record.snapshot.loop.dependencies)
      if (edge.to === current && !found.has(edge.from)) {
        found.add(edge.from);
        pending.push(edge.from);
      }
  return found;
};

/**
 * Inputs are the direct dependencies' results. Reviewers and validation steps judge one
 * candidate, so they also receive every upstream step that succeeded on that same candidate
 * (for example a checks step two hops back): a read-only reviewer cannot rerun those itself.
 */
const stepInputs = (record: RunRecord, stepId: string, candidateId?: string) => {
  const succeeded = (id: string) =>
    record.steps.find((step) => step.stepId === id)?.status === "succeeded";
  const sourceIds = record.snapshot.loop.dependencies
    .filter((edge) => edge.to === stepId)
    .map((edge) => edge.from)
    .filter(succeeded);
  const repeat = record.snapshot.loop.groups.find(
    (group) =>
      group.kind === "repeat" && group.continueWhen.to === stepId && record.implementationRound > 1,
  );
  if (repeat?.kind === "repeat") sourceIds.push(repeat.exitWhen.stepId);
  const definition = record.snapshot.loop.steps.find((step) => step.id === stepId);
  const candidate = candidateId ?? record.steps.find((step) => step.stepId === stepId)?.candidateId;
  if (candidate && (definition?.stage === "review" || definition?.stage === "validation"))
    for (const id of record.snapshot.loop.steps.map((step) => step.id))
      if (
        ancestorsOf(record, stepId).has(id) &&
        succeeded(id) &&
        record.steps.find((step) => step.stepId === id)?.candidateId === candidate
      )
        sourceIds.push(id);
  const sources = [...new Set(sourceIds)].map((id) => {
    const step = record.steps.find((item) => item.stepId === id);
    const attemptId = step?.attempts.at(-1)?.id;
    const evidence = record.evidence.filter(
      (item) => item.stepId === id && item.attemptId === attemptId,
    );
    const receipts = evidence.filter((item) => ["check", "review", "output"].includes(item.kind));
    const completed = [...evidence]
      .reverse()
      .find((item) => item.kind === "event" && item.title === "completed");
    return {
      stepId: id,
      outcome: step?.outcome,
      candidateId: step?.candidateId,
      attemptId,
      receipts: receipts.map((item) => item.id),
      output: [
        completed?.kind === "event" ? completed.detail : undefined,
        ...receipts.map((item) => JSON.stringify(item)),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  });
  const task = record.snapshot.task;
  const context = [
    task.description && `Task description:\n${task.description}`,
    task.ticket &&
      `Retrieved ticket ${task.ticket.id}: ${task.ticket.title}\n${task.ticket.summary}`,
    task.ticket?.attachments.length &&
      `Ticket attachments:\n${task.ticket.attachments.map((item) => `${item.title}: ${item.url}`).join("\n")}`,
    task.ticketId && issueContext(record, stepId, task.ticketId),
    writesRunBranch(record, stepId) &&
      `You are working in the project on branch ${record.snapshot.baseline.branch ?? ""}. Do not commit or switch branches; Code Factory commits your changes after this step succeeds.`,
    ...sources.map(
      (source) =>
        `Input from ${source.stepId} (outcome: ${source.outcome ?? "none"}, candidate: ${source.candidateId ?? "none"}):\n${source.output ?? ""}`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    context,
    receiptIds: sources.flatMap((source) => source.receipts),
    identities: sources,
  };
};

const reviewResult = (output: string): Pick<StepResult, "outcome" | "findings"> => {
  const [verdict, ...lines] = output.trim().split(/\r?\n/);
  return {
    outcome: verdict?.trim() ?? "",
    findings: lines.map((line) => line.trim()).filter(Boolean),
  };
};

const processGroupExists = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
};

const waitForProcessGroupExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(pid) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  return !processGroupExists(pid);
};

const terminateCheckTree = async (child: ChildProcess): Promise<boolean> => {
  if (!child.pid) return false;
  if (process.platform === "win32")
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => resolve(child.exitCode !== null));
      killer.once("close", (code) => resolve(code === 0 || child.exitCode !== null));
    });
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
  if (await waitForProcessGroupExit(child.pid, 2_000)) return true;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) return false;
  }
  return waitForProcessGroupExit(child.pid, 2_000);
};

type CommandInvocation = { shell: string } | { argv: readonly string[] };
type CommandResult = StepResult & {
  spawnFailed?: boolean;
  spawnErrorCode?: string;
  timedOut?: boolean;
  output?: string;
};

const checkCommand = async (
  invocation: CommandInvocation,
  cwd: string,
  signal: AbortSignal,
  onOutput: (text: string) => Promise<void>,
  timeoutMs = 300_000,
  env?: NodeJS.ProcessEnv,
): Promise<CommandResult> =>
  new Promise((resolveCheck) => {
    if (signal.aborted) return resolveCheck({ status: "canceled" });
    const options = {
      cwd,
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      ...(env ? { env } : {}),
    };
    const child =
      "shell" in invocation
        ? spawn(invocation.shell, { ...options, shell: true })
        : spawn(invocation.argv[0] ?? "", invocation.argv.slice(1), { ...options, shell: false });
    let output = "";
    let buffered = "";
    let retained = 0;
    let truncated = false;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let pending = Promise.resolve();
    const queue = (text: string) => {
      pending = pending.then(() => onOutput(text));
    };
    const flush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = undefined;
      if (buffered) {
        queue(buffered);
        buffered = "";
      }
    };
    const capture = (chunk: Buffer) => {
      const text = chunk.toString();
      output = (output + text).slice(-8192);
      const remaining = Math.max(0, 8192 - retained);
      const captured = text.slice(0, remaining);
      retained += captured.length;
      buffered += captured;
      if (buffered.length >= 1024) flush();
      else if (buffered && !flushTimer) flushTimer = setTimeout(flush, 100);
      if (text.length > remaining && !truncated) {
        flush();
        queue(
          "[Check output truncated after 8192 characters; final result retains the last 8192 characters.]",
        );
        truncated = true;
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      capture(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      capture(chunk);
    });
    let stopReason: "abort" | "timeout" | undefined;
    let termination: Promise<boolean> | undefined;
    const stop = (reason: "abort" | "timeout") => {
      stopReason ??= reason;
      termination ??= terminateCheckTree(child);
    };
    const timeout = setTimeout(() => stop("timeout"), timeoutMs);
    const abort = () => stop("abort");
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      flush();
      const failed: CommandResult = {
        status: "failed",
        outcome: "failed",
        summary: error.message,
        exitCode: null,
        spawnFailed: true,
        ...("code" in error && typeof error.code === "string"
          ? { spawnErrorCode: error.code }
          : {}),
      };
      void pending.then(
        () => resolveCheck(failed),
        () => resolveCheck(failed),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      flush();
      void Promise.all([pending, termination ?? Promise.resolve(true)]).then(
        ([, stopped]) =>
          resolveCheck({
            status: !stopped
              ? "unavailable"
              : stopReason === "abort"
                ? "canceled"
                : code === 0 && !stopReason
                  ? "succeeded"
                  : "failed",
            outcome: code === 0 ? "passed" : "failed",
            summary: !stopped
              ? "Check process-tree termination could not be confirmed."
              : stopReason === "timeout"
                ? `${output}\nCheck timed out after ${timeoutMs}ms.`.trim()
                : output,
            exitCode: code,
            timedOut: stopReason === "timeout",
            output,
          }),
        () => resolveCheck({ status: "failed", summary: "Check output could not be persisted." }),
      );
    });
  });

/** Execute the persisted graph with one scheduler and per-step adapters. Duplicate calls share work. */
export const executeRun = async (
  project: string,
  runId: string,
  resolveAdapter: Resolver,
): Promise<RunRecord> => {
  const key = `${project}:${runId}`;
  const existing = active.get(key);
  if (existing) {
    if (existing.retry) throw new Error("A selected retry is active.");
    return existing.work;
  }
  const controller = new AbortController();
  const work = executeOnce(project, runId, resolveAdapter, controller.signal);
  active.set(key, { work, controller });
  try {
    return await work;
  } finally {
    if (active.get(key)?.work === work) active.delete(key);
  }
};

/**
 * Run maintenance `work` (worktree removal) while holding the run's active slot, so no run, retry
 * or recovery can start until it settles. Returns null without running when the slot is taken.
 */
export const withIdleRunSlot = async (
  project: string,
  runId: string,
  work: () => Promise<RunRecord>,
): Promise<RunRecord | null> => {
  const key = `${project}:${runId}`;
  if (active.has(key)) return null;
  const pending = work();
  active.set(key, { work: pending, controller: new AbortController() });
  try {
    return await pending;
  } finally {
    if (active.get(key)?.work === pending) active.delete(key);
  }
};

/** A repeated request with the same prior attempt shares the one active retry. */
export const retryStep = async (
  project: string,
  runId: string,
  stepId: string,
  expectedAttemptId: string,
  resolveAdapter: Resolver,
): Promise<RunRecord> => {
  const key = `${project}:${runId}`;
  const retry = `${stepId}:${expectedAttemptId}`;
  const existing = active.get(key);
  if (existing) {
    if (existing.retry === retry) return existing.work;
    if (existing.retry) throw new Error("Another selected retry is active for this run.");
    // A failed step is persisted before its original execution has finished cleanup.
    // Wait for that work to settle before claiming the selected retry.
    await existing.work.catch(() => undefined);
    if (active.get(key) === existing) active.delete(key);
    return retryStep(project, runId, stepId, expectedAttemptId, resolveAdapter);
  }
  const controller = new AbortController();
  const work = executeOnce(project, runId, resolveAdapter, controller.signal, {
    stepId,
    expectedAttemptId,
  });
  active.set(key, { work, controller, retry });
  try {
    return await work;
  } finally {
    if (active.get(key)?.work === work) active.delete(key);
  }
};

export const cancelRun = async (project: string, runId: string): Promise<RunRecord> => {
  const running = active.get(`${project}:${runId}`);
  if (running) {
    running.controller.abort();
    return running.work;
  }
  // A run that is not executing (pending, or left "running" between steps by a restart) would
  // otherwise hold an in-project checkout forever, so it can be canceled directly.
  const record = await readRun(project, runId);
  if (!record) throw new ProjectError("Run not found.", 404);
  if (
    !["pending", "running"].includes(record.status) ||
    record.steps.some((step) => isActiveStatus(step.status))
  )
    throw new ProjectError("Run is not executing.", 409);
  return withIdleRunSlot(project, runId, () =>
    mutateRun(project, runId, (current) =>
      ["pending", "running"].includes(current.status) &&
      !current.steps.some((step) => isActiveStatus(step.status))
        ? runRecordSchema.parse({
            ...appendRunEvent(
              current,
              "lifecycle",
              "Run canceled",
              current.status === "pending"
                ? "Canceled before execution."
                : "Canceled while not executing.",
              "canceled",
            ),
            status: "canceled",
          })
        : current,
    ),
  ).then((result) => {
    if (!result) throw new ProjectError("Run is not executing.", 409);
    return result;
  });
};

const executeOnce = async (
  project: string,
  runId: string,
  resolveAdapter: Resolver,
  signal: AbortSignal,
  retry?: { stepId: string; expectedAttemptId: string },
): Promise<RunRecord> => {
  const initial = await readRun(project, runId);
  if (!initial) throw new Error("Run not found.");
  // A run canceled (or otherwise finished) between the execute request and this slot stays put;
  // in particular its setup command must not run in the user's checkout after a cancel.
  if (!retry && FINISHED_RUN.has(initial.status)) return initial;
  let record: RunRecord = initial;
  let pendingCommit: Promise<void> = Promise.resolve();
  const commit = async (
    change: (current: RunRecord) => RunRecord | Promise<RunRecord>,
  ): Promise<RunRecord> => {
    const work = pendingCommit.then(async () => {
      record = await mutateRun(project, runId, change);
    });
    pendingCommit = work;
    await work;
    return record;
  };
  let resolved: ResolvedWorkspace;
  try {
    resolved = await resolveRunWorkspace(project, record, { legacy: "prefix" });
  } catch (error) {
    // An in-project run whose checkout moved while the runtime was down: its active attempts are
    // interrupted (their processes are gone), and nothing is switched back automatically.
    if (error instanceof ProjectError && error.status === 409) {
      const reason = error.message;
      const activeSteps = record.steps.filter((step) => isActiveStatus(step.status));
      if (!activeSteps.length) throw error;
      for (const step of activeSteps)
        await commit((current) =>
          interruptStep(current, step.stepId, reason, "recovery-unavailable"),
        );
      return record;
    }
    // A removed or missing run worktree is reported, never re-created (FR6.2).
    const recoverable =
      error instanceof ProjectError &&
      error.status === 404 &&
      Boolean(record.snapshot.baseline.branch) &&
      (["pending", "running"].includes(record.status) ||
        record.steps.some((step) => isActiveStatus(step.status)));
    if (!recoverable) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    const activeSteps = record.steps.filter((step) => isActiveStatus(step.status));
    if (activeSteps.length) {
      for (const step of activeSteps)
        await commit((current) =>
          interruptStep(current, step.stepId, reason, "recovery-unavailable"),
        );
      return record;
    }
    return commit((current) =>
      runRecordSchema.parse({
        ...appendRunEvent(current, "lifecycle", "worktree-missing", reason, "unknown"),
        status: "unavailable",
      }),
    );
  }
  const workspace = resolved.path;
  const mode = resolved.digestMode;
  const isWorktreeRun = resolved.kind === "worktree";
  const isProjectRun = resolved.kind === "project";
  const commitsRunBranch = isWorktreeRun || isProjectRun;
  const runStep = async (stepId: string): Promise<void> => {
    const definition = record.snapshot.loop.steps.find((step) => step.id === stepId);
    if (!definition) throw new Error(`Unknown step ${stepId}.`);
    const readonly = definition.stage === "review";
    // In-project reviewers and checks run in the project itself; legacy runs keep frozen copies.
    const reviewRoot =
      readonly && !isProjectRun ? await mkdtemp(join(tmpdir(), "factory-review-")) : undefined;
    const executionDirectory = reviewRoot ? join(reviewRoot, "candidate") : workspace;
    const verifiesNoChange = isProjectRun && (readonly || definition.kind === "check");
    try {
      const step = record.steps.find((item) => item.stepId === stepId);
      const attempt = step?.attempts.at(-1);
      if (!step || !attempt) throw new Error("Claimed attempt missing.");
      // A copy failure is a failed attempt, not an interrupted run.
      let copyFailure: string | undefined;
      if (reviewRoot)
        copyFailure = await (
          isWorktreeRun
            ? createReviewCopy(workspace, executionDirectory, step.candidateId ?? "")
            : cp(workspace, executionDirectory, { recursive: true })
        ).then(
          () => undefined,
          (error: unknown) =>
            `Could not prepare the frozen review copy: ${error instanceof Error ? error.message : String(error)}`,
        );
      if (copyFailure) console.error("Review copy failed", runId, stepId, copyFailure);
      const recovering = initial.steps.some(
        (item) =>
          item.stepId === stepId &&
          item.attempts.at(-1)?.id === attempt.id &&
          isActiveStatus(item.status),
      );
      if (isProjectRun && !recovering) {
        // The user may switch branches mid-run; never run a step against another branch's files.
        const branch = record.snapshot.baseline.branch ?? "";
        const current = await currentBranch(workspace);
        if (current !== branch) {
          copyFailure = checkoutMovedMessage(branch, current);
          const detail = copyFailure;
          await commit((latest) =>
            appendLocalEvent(latest, stepId, attempt.id, "check", CHECKOUT_MOVED, detail, "failed"),
          );
        }
      }
      const filesBefore =
        verifiesNoChange && !copyFailure ? (await gitTreeState(workspace)).files : null;
      const base = record.snapshot.baseline.sourceRevision;
      const runChanges =
        isProjectRun && base && !copyFailure ? await listRunChangedFiles(workspace, base) : null;
      // Template loops call the gate by path, so a deleted `.code-factory/` cannot break a run.
      if (isProjectRun && !copyFailure) await ensureChangedFilesGate(workspace);
      const inputs = stepInputs(record, stepId);
      const inspectable =
        commitsRunBranch ||
        /^\.code-factory\/workspaces\/[0-9a-f-]{36}$/i.test(
          record.snapshot.baseline.workspace ?? "",
        );
      const beforeFiles =
        !readonly && !recovering && inspectable
          ? await snapshotFileDiffs(project, record).catch(() => null)
          : null;
      let result: StepResult;
      let staleCheck = false;
      if (definition.kind === "check") {
        if (recovering) {
          const completed = record.evidence.find(
            (item) =>
              item.kind === "event" &&
              item.attemptId === attempt.id &&
              item.title === "Check completed",
          );
          if (completed?.kind !== "event")
            throw new Error("A check process cannot be recovered after restart.");
          result = {
            status: completed.state === "succeeded" ? "succeeded" : "failed",
            outcome: completed.state === "succeeded" ? "passed" : "failed",
            ...(completed.detail ? { summary: completed.detail } : {}),
          };
        } else if (copyFailure) {
          result = { status: "failed", outcome: "failed", summary: copyFailure };
        } else {
          await commit((current) =>
            appendLocalEvent(
              current,
              stepId,
              attempt.id,
              "check",
              "Check started",
              definition.instruction,
              "running",
            ),
          );
          result = await checkCommand(
            { shell: definition.instruction },
            executionDirectory,
            signal,
            async (text) => {
              await commit((current) =>
                appendLocalEvent(current, stepId, attempt.id, "check", "Check output", text),
              );
            },
            undefined,
            runChanges && base ? checkEnvironment(base, runChanges) : undefined,
          );
        }
        const checkChanges = filesBefore
          ? changedFiles(filesBefore, (await gitTreeState(workspace)).files)
          : null;
        staleCheck = checkChanges
          ? checkChanges.length > 0
          : (await fileDigest(workspace, mode)) !== step.candidateId;
        if (staleCheck)
          result = {
            status: "failed",
            outcome: "failed",
            summary: checkChanges?.length
              ? readOnlyViolation("Check", checkChanges)
              : "Check changed the candidate; its result is stale.",
            exitCode: result.exitCode ?? null,
          };
        if (checkChanges?.length) {
          const detail = readOnlyViolation("Check", checkChanges);
          await commit((current) =>
            appendLocalEvent(
              current,
              stepId,
              attempt.id,
              "check",
              READ_ONLY_VIOLATION,
              detail,
              "failed",
            ),
          );
        }
        if (!recovering)
          await commit((current) =>
            appendLocalEvent(
              current,
              stepId,
              attempt.id,
              "check",
              "Check completed",
              result.summary,
              result.status,
            ),
          );
      } else {
        const priorCompletion = recovering
          ? record.evidence.find(
              (item) =>
                item.kind === "event" &&
                item.attemptId === attempt.id &&
                item.title === "completed",
            )
          : undefined;
        const binding = record.snapshot.bindings[stepId];
        const adapter = binding ? resolveAdapter(binding.provider) : null;
        if (priorCompletion?.kind === "event") {
          result = {
            status: priorCompletion.state === "succeeded" ? "succeeded" : "failed",
            ...(priorCompletion.detail
              ? definition.stage === "review"
                ? reviewResult(priorCompletion.detail)
                : { outcome: priorCompletion.detail.trim() }
              : {}),
            ...(priorCompletion.detail ? { summary: priorCompletion.detail } : {}),
          };
        } else if (copyFailure) {
          result = { status: "failed", summary: copyFailure };
        } else if (!adapter || !binding) {
          result = { status: "unavailable" };
          if (recovering) throw new Error("The selected adapter is not connected for recovery.");
        } else {
          result = { status: "failed" };
          const allowedOutcomes =
            record.snapshot.loop.decisions
              .find((item) => item.stepId === stepId)
              ?.branches.map((branch) => branch.outcome) ??
            (definition.stage === "review" ? ["pass", "changes-requested", "blocked"] : undefined);
          const input: StepExecutionInput = {
            runId,
            stepId,
            attempt: attempt.number,
            instruction: [
              definition.instruction,
              inputs.context,
              runChanges && base && changedFilesContext(base, runChanges),
              allowedOutcomes &&
                (definition.stage === "review"
                  ? `Put exactly one verdict on the first line: ${allowedOutcomes.join(", ")}. Add concrete findings on subsequent lines when requesting changes.`
                  : `Return exactly one outcome: ${allowedOutcomes.join(", ")}.`),
            ]
              .filter(Boolean)
              .join("\n\n"),
            ...(allowedOutcomes ? { allowedOutcomes } : {}),
            binding,
            projectDirectory: executionDirectory,
            ...(readonly ? { readOnly: true } : {}),
          };
          if (readonly && !recovering && binding.provider !== "mock")
            await commit((current) =>
              appendLocalEvent(
                current,
                stepId,
                attempt.id,
                "lifecycle",
                TOOL_PERMISSION,
                `Read-only reviewer: ${binding.provider} runs without write or shell permissions it can enforce, and the project's tool grant does not apply.`,
              ),
            );
          // A grant is read per fresh attempt, so grant and revoke apply at the next attempt.
          if (!readonly && !recovering && binding.provider !== "mock") {
            const permission = await resolveToolGrant(project, binding.provider);
            if (permission.grant) input.toolGrant = permission.grant;
            await commit((current) =>
              appendLocalEvent(
                current,
                stepId,
                attempt.id,
                "lifecycle",
                TOOL_PERMISSION,
                describeToolGrant(
                  binding.provider,
                  permission.grant,
                  executionDirectory,
                  permission.note,
                ),
              ),
            );
          }
          let cancellationUnconfirmed = false;
          try {
            let completed = false;
            if (
              recovering &&
              (adapter.capabilities.resume !== "supported" ||
                !attempt.sessionId ||
                !attempt.turnId ||
                readonly)
            )
              throw new Error("Active recovery is unsupported or lacks a verified session handle.");
            const stream = recovering
              ? adapter.attach(
                  {
                    runId,
                    stepId,
                    attempt: attempt.number,
                    sessionId: attempt.sessionId ?? "",
                    turnId: attempt.turnId ?? "",
                  },
                  signal,
                )
              : adapter.execute(input, signal);
            for await (const event of stream) {
              if (
                event.runId !== runId ||
                event.stepId !== stepId ||
                event.attempt !== attempt.number ||
                (recovering &&
                  (event.sessionId !== attempt.sessionId || event.turnId !== attempt.turnId))
              )
                throw new Error("Adapter event identity mismatch.");
              if (event.type === "started" && !recovering)
                await commit((current) =>
                  attachAttemptSession(current, stepId, event.sessionId, event.turnId),
                );
              if (event.type === "completed") completed = true;
              if (event.type === "completed")
                result = {
                  status: event.outcome,
                  ...(definition.stage === "review"
                    ? reviewResult(event.output)
                    : { outcome: event.output.trim() }),
                  summary: event.output,
                };
              if (event.type === "input-request")
                await commit((current) => recordInputRequest(current, stepId, attempt.id, event));
              else await commit((current) => appendEvent(current, stepId, attempt.id, event));
              if (event.type === "started")
                record = await deliverQueuedGuidance(project, record, stepId, attempt.id, adapter);
            }
            if (!completed) throw new Error("Adapter stream ended without a verified completion.");
          } catch (error) {
            if (error instanceof CancellationUnconfirmedError) {
              cancellationUnconfirmed = true;
              result = { status: "unavailable", summary: error.message };
            } else {
              if (!signal.aborted) throw error;
              result = { status: "canceled" };
            }
          }
          if (signal.aborted && !cancellationUnconfirmed) result = { status: "canceled" };
        }
      }
      if (readonly && filesBefore) {
        const reviewChanges = changedFiles(filesBefore, (await gitTreeState(workspace)).files);
        if (reviewChanges.length && result.status !== "canceled") {
          result = { status: "failed", summary: readOnlyViolation("Reviewer", reviewChanges) };
          const detail = result.summary;
          await commit((current) =>
            appendLocalEvent(
              current,
              stepId,
              attempt.id,
              "check",
              READ_ONLY_VIOLATION,
              detail,
              "failed",
            ),
          );
        }
      } else if (
        readonly &&
        !copyFailure &&
        result.status === "succeeded" &&
        (await fileDigest(executionDirectory, mode)) !== step.candidateId
      )
        result = { status: "failed", summary: "Reviewer changed the frozen candidate." };
      const blockedSummary = result.summary;
      if (
        result.status === "succeeded" &&
        record.snapshot.task.ticketId &&
        blockedSummary !== undefined &&
        isIssueBlockedOutput(blockedSummary, record.snapshot.task.ticketId)
      )
        result = { status: "failed", summary: blockedSummary };
      const decision = record.snapshot.loop.decisions.find((item) => item.stepId === stepId);
      if (
        result.status === "succeeded" &&
        decision &&
        !decision.branches.some((branch) => branch.outcome === result.outcome)
      )
        result = {
          status: "failed",
          summary: `Undeclared decision outcome: ${result.outcome ?? "none"}`,
        };
      if (
        result.status === "succeeded" &&
        definition.stage === "review" &&
        (!["pass", "changes-requested", "blocked"].includes(result.outcome ?? "") ||
          (result.outcome === "changes-requested" && !result.findings?.length))
      )
        result = {
          status: "failed",
          summary:
            result.outcome === "changes-requested"
              ? "Review requested changes without actionable findings."
              : `Undeclared review verdict: ${result.outcome ?? "none"}`,
        };
      // Commit after every result re-validation and before the digest, so hook edits (formatters)
      // belong to the recorded candidate and a failed result never reaches the branch.
      if (result.status === "succeeded" && commitsRunBranch && writesRunBranch(record, stepId)) {
        const outcome = await commitStepChanges(workspace, record, stepId, attempt);
        if (outcome.kind === "committed")
          await commit((current) =>
            appendLocalEvent(
              current,
              stepId,
              attempt.id,
              "lifecycle",
              "commit-created",
              `${outcome.sha} ${outcome.subject}`,
            ),
          );
        if (outcome.kind === "failed") {
          await commit((current) =>
            appendLocalEvent(
              current,
              stepId,
              attempt.id,
              "check",
              "commit-failed",
              `Exit ${outcome.exitCode ?? "none"}\n${outcome.output}`,
              "failed",
            ),
          );
          result = { status: "failed", summary: outcome.summary };
        }
      }
      const candidateId =
        definition.kind === "check" && step.candidateId
          ? step.candidateId
          : await fileDigest(workspace, mode);
      await commit((current) => completeStep(current, stepId, { ...result, candidateId }));
      if (beforeFiles) {
        const afterFiles = await snapshotFileDiffs(project, record).catch(() => null);
        if (afterFiles)
          await commit((current) =>
            appendFileReceipts(
              current,
              stepId,
              attempt.id,
              beforeFiles,
              afterFiles,
              inputs.receiptIds,
              definition.kind === "check" ? "check" : "agent",
              staleCheck,
            ),
          );
      }
      if (
        definition.kind === "check" ||
        (definition.stage === "review" && result.status === "succeeded")
      )
        await commit((current) =>
          appendReceipt(
            current,
            stepId,
            attempt.id,
            definition.instruction,
            result,
            inputs.receiptIds,
            staleCheck,
          ),
        );
    } catch (error) {
      if (isActiveStatus(record.steps.find((step) => step.stepId === stepId)?.status ?? ""))
        await commit((current) =>
          initial.steps.some((item) => item.stepId === stepId && isActiveStatus(item.status)) ||
          (definition.kind !== "check" && !signal.aborted)
            ? interruptStep(
                current,
                stepId,
                error instanceof Error ? error.message : String(error),
                initial.steps.some((item) => item.stepId === stepId && isActiveStatus(item.status))
                  ? "recovery-unavailable"
                  : "execution-interrupted",
              )
            : completeStep(current, stepId, {
                status: signal.aborted ? "canceled" : "failed",
                summary: error instanceof Error ? error.message : String(error),
              }),
        );
    } finally {
      const finalAttemptId = record.steps
        .find((item) => item.stepId === stepId)
        ?.attempts.at(-1)?.id;
      if (finalAttemptId)
        await commit((current) => expireQueuedGuidance(current, stepId, finalAttemptId));
      if (reviewRoot) await rm(reviewRoot, { recursive: true, force: true });
    }
  };

  const setupCommand = record.snapshot.setupCommand;
  const setupDone = record.evidence.some(
    (item) =>
      item.kind === "event" &&
      !item.stepId &&
      item.title === SETUP_COMPLETED &&
      item.state === "succeeded",
  );
  if (!retry && setupCommand && !setupDone && !record.steps.some((step) => step.attempts.length)) {
    if (record.status === "pending")
      await commit((current) =>
        runRecordSchema.parse({ ...current, revision: current.revision + 1, status: "running" }),
      );
    await commit((current) =>
      appendRunEvent(current, "check", SETUP_STARTED, formatCommandLine(setupCommand)),
    );
    const outcome = await checkCommand(
      { argv: setupCommand },
      workspace,
      signal,
      async (text) => {
        await commit((current) => appendRunEvent(current, "check", SETUP_OUTPUT, text));
      },
      SETUP_TIMEOUT_MS,
    );
    const output = outcome.output ?? "";
    const state =
      outcome.status === "succeeded"
        ? "succeeded"
        : outcome.status === "canceled"
          ? "canceled"
          : "failed";
    const spawnFailed = outcome.spawnFailed === true;
    let detail = spawnFailed
      ? `Could not start ${setupCommand[0] ?? ""}: ${outcome.spawnErrorCode ?? outcome.summary ?? "unknown error"}`
      : state === "canceled"
        ? `Canceled\n${output}`
        : outcome.timedOut
          ? `Timed out after ${SETUP_TIMEOUT_MS / 1000} s\n${output}`
          : `Exit ${outcome.exitCode ?? "none"}\n${output}`;
    if (state === "succeeded" && commitsRunBranch) {
      const changed = await listUncommittedPaths(workspace).catch(() => []);
      if (changed.length)
        detail += `\nChanged tracked files: ${changed.slice(0, 50).join(", ")}${changed.length > 50 ? ` and ${changed.length - 50} more` : ""}`;
    }
    record = await commit((current) => {
      const next = appendRunEvent(current, "check", SETUP_COMPLETED, detail.trimEnd(), state);
      return state === "succeeded" ? next : runRecordSchema.parse({ ...next, status: state });
    });
    if (state !== "succeeded") return record;
  }

  if (retry) {
    record = await commit((current) =>
      prepareStepRetry(current, retry.stepId, retry.expectedAttemptId),
    );
    const candidateId = await fileDigest(workspace, mode);
    const inputs = stepInputs(record, retry.stepId, candidateId);
    const inputHash = hashInputs(candidateId, [inputs.context, JSON.stringify(inputs.identities)]);
    record = await commit((current) => claimStep(current, retry.stepId, candidateId, inputHash));
    await runStep(retry.stepId);
    if (record.status !== "running") return record;
  }

  const interrupted = record.steps.filter((step) => isActiveStatus(step.status));
  if (interrupted.length) {
    await Promise.all(interrupted.map((step) => runStep(step.stepId)));
    if (record.status === "unavailable") return record;
  }
  for (;;) {
    if (record.status === "unavailable") return record;
    if (signal.aborted)
      return commit((current) =>
        runRecordSchema.parse({ ...current, revision: current.revision + 1, status: "canceled" }),
      );
    record = await commit(skipInactive);
    const repeat = record.snapshot.loop.groups.find(
      (group) =>
        group.kind === "repeat" &&
        record.steps.find((step) => step.stepId === group.exitWhen.stepId)?.outcome ===
          group.continueWhen.outcome,
    );
    if (repeat?.kind === "repeat") {
      record = await commit((current) => continueRepeat(current, repeat.exitWhen.stepId));
      if (record.status === "rejected") return record;
    }
    const ready = readySteps(record);
    if (!ready.length) return commit(settleRun);
    const candidateId = await fileDigest(workspace, mode);
    const selected = ready.some((step) => step.stage !== "review")
      ? ready.filter((step) => step.stage !== "review").slice(0, 1)
      : ready;
    const launched: string[] = [];
    for (const definition of selected) {
      const inputs = stepInputs(record, definition.id, candidateId);
      const inputHash = hashInputs(candidateId, [
        inputs.context,
        JSON.stringify(inputs.identities),
      ]);
      record = await commit((current) => claimStep(current, definition.id, candidateId, inputHash));
      launched.push(definition.id);
    }
    await Promise.all(launched.map(runStep));
  }
};

const appendEvent = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  event: AdapterEvent,
): RunRecord => {
  const sequence =
    Math.max(
      -1,
      ...record.evidence.filter((item) => item.kind === "event").map((item) => item.sequence),
    ) + 1;
  const next = runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    evidence: [
      ...record.evidence,
      {
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        stepId,
        attemptId,
        createdAt: new Date().toISOString(),
        kind: "event",
        type: ["message", "tool", "check", "error"].includes(event.type) ? event.type : "lifecycle",
        title: event.type === "tool" || event.type === "check" ? event.title : event.type,
        detail:
          event.type === "message"
            ? event.text
            : event.type === "error"
              ? event.text
              : event.type === "tool" || event.type === "check"
                ? event.detail
                : event.type === "completed"
                  ? event.output
                  : undefined,
        state:
          event.type === "completed" ? event.outcome : "state" in event ? event.state : undefined,
        sessionId: event.sessionId,
        turnId: event.turnId,
        sequence,
      },
    ],
  });
  const last = next.evidence.at(-1);
  return event.type === "message" && last?.kind === "event"
    ? acknowledgeGuidance(next, stepId, attemptId, last.id)
    : next;
};

const recordInputRequest = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  event: Extract<AdapterEvent, { type: "input-request" }>,
): RunRecord => {
  if (!event.isBlocking) throw new Error("Only blocking native requests can wait for input.");
  const waiting = setAttemptControlState(record, stepId, attemptId, "waiting-input");
  return runRecordSchema.parse({
    ...waiting,
    revision: waiting.revision,
    evidence: [
      ...waiting.evidence,
      {
        id: crypto.randomUUID(),
        runId: waiting.snapshot.id,
        stepId,
        attemptId,
        createdAt: new Date().toISOString(),
        kind: "input-request",
        sessionId: event.sessionId,
        turnId: event.turnId,
        itemId: event.itemId,
        requestId: event.requestId,
        questions: event.questions,
        isBlocking: true,
        autoResolutionMs: event.autoResolutionMs,
      },
    ],
  });
};

const appendLocalEvent = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  type: "check" | "lifecycle",
  title: string,
  detail?: string,
  state?: string,
): RunRecord => appendScopedEvent(record, { stepId, attemptId }, type, title, detail, state);

const interruptStep = (
  record: RunRecord,
  stepId: string,
  reason: string,
  title: "recovery-unavailable" | "execution-interrupted",
): RunRecord => {
  const step = record.steps.find((item) => item.stepId === stepId);
  const attempt = step?.attempts.at(-1);
  if (!attempt || !isActiveStatus(attempt.status)) return record;
  const interrupted = runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    status: "unavailable",
    steps: record.steps.map((item) =>
      item.stepId === stepId
        ? {
            ...item,
            status: "waiting",
            attempts: item.attempts.map((entry) =>
              entry.id === attempt.id
                ? { ...entry, status: "interrupted", endedAt: new Date().toISOString() }
                : entry,
            ),
          }
        : item,
    ),
  });
  const sequence =
    Math.max(
      -1,
      ...interrupted.evidence.filter((item) => item.kind === "event").map((item) => item.sequence),
    ) + 1;
  return runRecordSchema.parse({
    ...interrupted,
    revision: interrupted.revision,
    evidence: [
      ...interrupted.evidence,
      {
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        stepId,
        attemptId: attempt.id,
        createdAt: new Date().toISOString(),
        kind: "event",
        type: "lifecycle",
        title,
        detail: reason,
        state: "unknown",
        ...(attempt.sessionId ? { sessionId: attempt.sessionId, turnId: attempt.turnId } : {}),
        sequence,
      },
    ],
  });
};

const appendReceipt = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  instruction: string,
  result: StepResult,
  inputReceiptIds: string[],
  stale: boolean,
): RunRecord => {
  const step = record.steps.find((item) => item.stepId === stepId);
  if (!step?.candidateId || !step.inputHash) throw new Error("Step has no frozen inputs.");
  const definition = record.snapshot.loop.steps.find((item) => item.id === stepId);
  const provenance = {
    source: definition?.kind === "check" ? "check" : "agent",
    baselineId: record.snapshot.baseline.id,
    candidateId: step.candidateId,
    inputReceiptIds,
  };
  const freshness = {
    state: stale ? "superseded" : "current",
    checkedAgainstCandidateId: step.candidateId,
  };
  const common = {
    id: crypto.randomUUID(),
    runId: record.snapshot.id,
    stepId,
    attemptId,
    createdAt: new Date().toISOString(),
    provenance,
    freshness,
  };
  const receipt =
    definition?.kind === "check"
      ? {
          ...common,
          kind: "check",
          command: instruction,
          outcome: result.status === "succeeded" ? "passed" : "failed",
          exitCode: result.exitCode ?? null,
          summary: result.summary ?? "",
          inputHash: step.inputHash,
        }
      : {
          ...common,
          kind: "review",
          scope: instruction,
          verdict:
            result.outcome === "pass"
              ? "pass"
              : result.outcome === "changes-requested"
                ? "changes-requested"
                : "blocked",
          findings: result.findings ?? [],
          inputHash: step.inputHash,
        };
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    evidence: [...record.evidence, receipt],
  });
};
