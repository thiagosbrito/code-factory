import { type RunRecord } from "../domain/run.js";
import { type StepResult } from "../domain/scheduler.js";
import {
  extractRetrievedIssue,
  issueBlockedSentinel,
  retrievedIssueEnd,
  retrievedIssueStart,
} from "../domain/ticket.js";
import { declaredOutcome, firstLineOutcome } from "../domain/outcome.js";
import { CHANGED_FILES_GATE_PATH } from "../domain/gates.js";

export const issueLookupInstruction = (ticketId: string): string =>
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
export const issueContext = (record: RunRecord, stepId: string, ticketId: string): string => {
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
export const writesRunBranch = (record: RunRecord, stepId: string): boolean => {
  const definition = record.snapshot.loop.steps.find((step) => step.id === stepId);
  return (
    Boolean(record.snapshot.baseline.branch) &&
    definition?.kind === "agent" &&
    definition.stage !== "review"
  );
};

/** Changed-file facts for in-project runs, given to check commands as environment variables. */
export const checkEnvironment = (base: string, files: string[]): NodeJS.ProcessEnv => ({
  ...process.env,
  CODE_FACTORY_BASE_REVISION: base,
  // Newline-separated, so `$CODE_FACTORY_CHANGED_FILES` expands to one argument per file in sh.
  CODE_FACTORY_CHANGED_FILES: files.join("\n"),
});

/** The same facts for agent steps, so they can scope their own checks to this run's changes. */
export const changedFilesContext = (base: string, files: string[]): string =>
  [
    files.length
      ? `This run started at commit ${base}. Files changed by this run so far (${files.length}):\n${files.slice(0, 200).join("\n")}${files.length > 200 ? `\n… and ${files.length - 200} more (git diff --name-only ${base})` : ""}`
      : `This run started at commit ${base}. No files have changed in this run yet.`,
    `The changed-files gates run as \`node ${CHANGED_FILES_GATE_PATH} <lint|types|coverage> --base ${base}\` from the project root.`,
  ].join("\n");

/** Every step upstream of `stepId` in the declared dependency graph. */
export const ancestorsOf = (record: RunRecord, stepId: string): Set<string> => {
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
export const stepInputs = (record: RunRecord, stepId: string, candidateId?: string) => {
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

export const reviewResult = (output: string): Pick<StepResult, "outcome" | "findings"> => {
  const [, ...lines] = output.trim().split(/\r?\n/);
  return {
    outcome: firstLineOutcome(output),
    findings: lines.map((line) => line.trim()).filter(Boolean),
  };
};

/**
 * A decision step's outcome is the declared branch named on its first line; other agent steps
 * keep their whole output as the outcome, as before.
 */
export const agentOutcome = (record: RunRecord, stepId: string, output: string): string => {
  const branches = record.snapshot.loop.decisions
    .find((item) => item.stepId === stepId)
    ?.branches.map((branch) => branch.outcome);
  if (!branches) return output.trim();
  return declaredOutcome(output, branches) ?? output.trim().split(/\r?\n/)[0]?.trim() ?? "";
};

export const AGENT_NOT_CONNECTED = "agent-not-connected";
export const agentNotConnected = (provider: string): string =>
  `${provider} is not connected in this Code Factory session (verified connections last until the runtime restarts). Verify it in Settings, then retry this step.`;

/** Evidence title for an agent result that Code Factory rejected after the agent reported success. */
export const RESULT_REJECTED = "result-rejected";

export type StepInputs = ReturnType<typeof stepInputs>;
