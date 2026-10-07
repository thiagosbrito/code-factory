import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, readFile, readdir, readlink, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
  CancellationUnconfirmedError,
  type AgentAdapter,
  type AdapterEvent,
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
import { mutateRun, readRun } from "./storage.js";
import { acknowledgeGuidance, deliverQueuedGuidance, expireQueuedGuidance } from "./guidance.js";
import { snapshotFileDiffs } from "./inspection.js";

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
const isActiveStatus = (status: string): boolean =>
  status === "running" || status === "waiting-input" || status === "paused";
const active = new Map<
  string,
  { work: Promise<RunRecord>; controller: AbortController; retry?: string }
>();

export const workspaceFor = async (project: string, record: RunRecord): Promise<string> => {
  const relative = record.snapshot.baseline.workspace;
  if (!relative || !relative.startsWith(".code-factory/workspaces/"))
    throw new Error("Run has no isolated execution workspace.");
  const root = await realpath(join(project, ".code-factory", "workspaces"));
  const workspace = await realpath(resolve(project, relative));
  if (!workspace.startsWith(`${root}${sep}`))
    throw new Error("Run workspace escapes project storage.");
  return workspace;
};

export const fileDigest = async (directory: string): Promise<string> => {
  const hash = createHash("sha256");
  const visit = async (folder: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name === ".git" || entry.name === ".code-factory") continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(folder, entry.name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) {
        hash.update(`link:${relative}:${await readlink(path)}`);
      } else if (stats.isDirectory()) {
        await visit(path, relative);
      } else if (stats.isFile()) {
        hash.update(`file:${relative}:`);
        hash.update(await readFile(path));
      }
    }
  };
  await visit(directory, "");
  return hash.digest("hex");
};

const stepInputs = (record: RunRecord, stepId: string) => {
  const sourceIds = record.snapshot.loop.dependencies
    .filter((edge) => edge.to === stepId)
    .map((edge) => edge.from)
    .filter((id) => record.steps.find((step) => step.stepId === id)?.status === "succeeded");
  const repeat = record.snapshot.loop.groups.find(
    (group) =>
      group.kind === "repeat" && group.continueWhen.to === stepId && record.implementationRound > 1,
  );
  if (repeat?.kind === "repeat") sourceIds.push(repeat.exitWhen.stepId);
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

const checkCommand = async (
  command: string,
  cwd: string,
  signal: AbortSignal,
  onOutput: (text: string) => Promise<void>,
): Promise<StepResult> =>
  new Promise((resolveCheck) => {
    if (signal.aborted) return resolveCheck({ status: "canceled" });
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
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
    const timeout = setTimeout(() => stop("timeout"), 300_000);
    const abort = () => stop("abort");
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      flush();
      void pending.then(
        () =>
          resolveCheck({
            status: "failed",
            outcome: "failed",
            summary: error.message,
            exitCode: null,
          }),
        () =>
          resolveCheck({
            status: "failed",
            outcome: "failed",
            summary: error.message,
            exitCode: null,
          }),
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
                ? `${output}\nCheck timed out after 300000ms.`.trim()
                : output,
            exitCode: code,
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
    active.delete(key);
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
    if (existing.retry !== retry) throw new Error("Another execution is active for this run.");
    return existing.work;
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
    active.delete(key);
  }
};

export const cancelRun = async (project: string, runId: string): Promise<RunRecord> => {
  const running = active.get(`${project}:${runId}`);
  if (!running) throw new Error("Run is not executing.");
  running.controller.abort();
  return running.work;
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
  let record: RunRecord = initial;
  const workspace = await workspaceFor(project, record);
  let pendingCommit: Promise<void> = Promise.resolve();
  const commit = async (change: (current: RunRecord) => RunRecord): Promise<RunRecord> => {
    const work = pendingCommit.then(async () => {
      record = await mutateRun(project, runId, change);
    });
    pendingCommit = work;
    await work;
    return record;
  };
  const runStep = async (stepId: string): Promise<void> => {
    const definition = record.snapshot.loop.steps.find((step) => step.id === stepId);
    if (!definition) throw new Error(`Unknown step ${stepId}.`);
    const readonly = definition.stage === "review";
    const reviewRoot = readonly ? await mkdtemp(join(tmpdir(), "factory-review-")) : undefined;
    const executionDirectory = reviewRoot ? join(reviewRoot, "candidate") : workspace;
    try {
      if (reviewRoot)
        await cp(workspace, executionDirectory, {
          recursive: true,
        });
      const step = record.steps.find((item) => item.stepId === stepId);
      const attempt = step?.attempts.at(-1);
      if (!step || !attempt) throw new Error("Claimed attempt missing.");
      const recovering = initial.steps.some(
        (item) =>
          item.stepId === stepId &&
          item.attempts.at(-1)?.id === attempt.id &&
          isActiveStatus(item.status),
      );
      const inputs = stepInputs(record, stepId);
      const inspectable = /^\.code-factory\/workspaces\/[0-9a-f-]{36}$/i.test(
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
            definition.instruction,
            executionDirectory,
            signal,
            async (text) => {
              await commit((current) =>
                appendLocalEvent(current, stepId, attempt.id, "check", "Check output", text),
              );
            },
          );
        }
        staleCheck = (await fileDigest(workspace)) !== step.candidateId;
        if (staleCheck)
          result = {
            status: "failed",
            outcome: "failed",
            summary: "Check changed the candidate; its result is stale.",
            exitCode: result.exitCode ?? null,
          };
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
          const input = {
            runId,
            stepId,
            attempt: attempt.number,
            instruction: [
              definition.instruction,
              inputs.context,
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
          };
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
      if (
        readonly &&
        result.status === "succeeded" &&
        (await fileDigest(executionDirectory)) !== step.candidateId
      )
        result = { status: "failed", summary: "Reviewer changed the frozen candidate." };
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
      const candidateId =
        definition.kind === "check" && step.candidateId
          ? step.candidateId
          : await fileDigest(workspace);
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

  if (retry) {
    record = await commit((current) =>
      prepareStepRetry(current, retry.stepId, retry.expectedAttemptId),
    );
    const candidateId = await fileDigest(workspace);
    const inputs = stepInputs(record, retry.stepId);
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
    const candidateId = await fileDigest(workspace);
    const selected = ready.some((step) => step.stage !== "review")
      ? ready.filter((step) => step.stage !== "review").slice(0, 1)
      : ready;
    const launched: string[] = [];
    for (const definition of selected) {
      const inputs = stepInputs(record, definition.id);
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
        stepId,
        attemptId,
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
