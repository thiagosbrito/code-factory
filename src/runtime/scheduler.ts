import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, readFile, readdir, readlink, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import type { AgentAdapter, AdapterEvent } from "../adapters/contract.js";
import { attachAttemptSession, runRecordSchema, type RunRecord } from "../domain/run.js";
import {
  claimStep,
  completeStep,
  continueRepeat,
  hashInputs,
  readySteps,
  settleRun,
  skipInactive,
  type StepResult,
} from "../domain/scheduler.js";
import { readRun, updateRun } from "./storage.js";

type Resolver = (provider: string) => AgentAdapter | null;
const active = new Map<string, { work: Promise<RunRecord>; controller: AbortController }>();

const workspaceFor = async (project: string, record: RunRecord): Promise<string> => {
  const relative = record.snapshot.baseline.workspace;
  if (!relative || !relative.startsWith(".code-factory/workspaces/"))
    throw new Error("Run has no isolated execution workspace.");
  const root = await realpath(join(project, ".code-factory", "workspaces"));
  const workspace = await realpath(resolve(project, relative));
  if (!workspace.startsWith(`${root}${sep}`))
    throw new Error("Run workspace escapes project storage.");
  return workspace;
};

const fileDigest = async (directory: string): Promise<string> => {
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

const checkCommand = async (
  command: string,
  cwd: string,
  signal: AbortSignal,
): Promise<StepResult> =>
  new Promise((resolveCheck) => {
    if (signal.aborted) return resolveCheck({ status: "canceled" });
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8192);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8192);
    });
    const timeout = setTimeout(() => child.kill("SIGTERM"), 300_000);
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      resolveCheck({ status: "failed", outcome: "failed", summary: error.message, exitCode: null });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      resolveCheck({
        status: signal.aborted ? "canceled" : code === 0 ? "succeeded" : "failed",
        outcome: code === 0 ? "passed" : "failed",
        summary: output,
        exitCode: code,
      });
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
  if (existing) return existing.work;
  const controller = new AbortController();
  const work = executeOnce(project, runId, resolveAdapter, controller.signal);
  active.set(key, { work, controller });
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
): Promise<RunRecord> => {
  const initial = await readRun(project, runId);
  if (!initial) throw new Error("Run not found.");
  let record: RunRecord = initial;
  const workspace = await workspaceFor(project, record);
  let pendingCommit: Promise<void> = Promise.resolve();
  const commit = async (change: (current: RunRecord) => RunRecord): Promise<RunRecord> => {
    const work = pendingCommit.then(async () => {
      const next = change(record);
      if (next !== record) record = await updateRun(project, next);
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
      const inputs = stepInputs(record, stepId);
      let result: StepResult;
      let staleCheck = false;
      if (definition.kind === "check") {
        result = await checkCommand(definition.instruction, executionDirectory, signal);
        staleCheck = (await fileDigest(workspace)) !== step.candidateId;
        if (staleCheck)
          result = {
            status: "failed",
            outcome: "failed",
            summary: "Check changed the candidate; its result is stale.",
            exitCode: result.exitCode ?? null,
          };
      } else {
        const binding = record.snapshot.bindings[stepId];
        const adapter = binding ? resolveAdapter(binding.provider) : null;
        if (!adapter || !binding) {
          result = { status: "unavailable" };
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
          try {
            for await (const event of adapter.execute(input, signal)) {
              if (
                event.runId !== runId ||
                event.stepId !== stepId ||
                event.attempt !== attempt.number
              )
                throw new Error("Adapter event identity mismatch.");
              if (event.type === "started")
                await commit((current) =>
                  attachAttemptSession(current, stepId, event.sessionId, event.turnId),
                );
              if (event.type === "completed")
                result = {
                  status: event.outcome,
                  ...(definition.stage === "review"
                    ? reviewResult(event.output)
                    : { outcome: event.output.trim() }),
                  summary: event.output,
                };
              await commit((current) => appendEvent(current, stepId, attempt.id, event));
            }
          } catch {
            result = { status: signal.aborted ? "canceled" : "failed" };
          }
        }
      }
      if (signal.aborted) result = { status: "canceled" };
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
      if (record.steps.find((step) => step.stepId === stepId)?.status === "running")
        await commit((current) =>
          completeStep(current, stepId, {
            status: signal.aborted ? "canceled" : "failed",
            summary: error instanceof Error ? error.message : String(error),
          }),
        );
    } finally {
      if (reviewRoot) await rm(reviewRoot, { recursive: true, force: true });
    }
  };

  for (;;) {
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
        type: event.type === "message" ? "message" : "lifecycle",
        title: event.type,
        detail:
          event.type === "message"
            ? event.text
            : event.type === "completed"
              ? event.output
              : undefined,
        state: event.type === "completed" ? event.outcome : undefined,
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
