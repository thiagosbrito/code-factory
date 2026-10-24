import type { RunRecord } from "../domain/run.js";
import type { StepInputs } from "./scheduler-inputs.js";
import type { Resolver } from "./scheduler-constants.js";
import type { FileSnapshot } from "./scheduler-evidence.js";
import { mutateRun, isRunPersistenceError } from "./storage.js";
import type { gitTreeState, ResolvedWorkspace } from "./workspace.js";

export type Commit = (
  change: (current: RunRecord) => RunRecord | Promise<RunRecord>,
) => Promise<RunRecord>;

/** What one `executeOnce` call shares across its steps. */
export type RunContext = {
  readonly project: string;
  readonly runId: string;
  /** The record read once at the start; recovery detection compares attempts against it. */
  readonly initial: RunRecord;
  readonly signal: AbortSignal;
  readonly resolveAdapter: Resolver;
  /** The latest record. Read it where it is used; never keep it across an await. */
  readonly record: () => RunRecord;
  /** Only for writes that bypass `commit`, and the sites that assign a commit's result. */
  readonly setRecord: (next: RunRecord) => void;
  /** The one FIFO chain for this run: every write is serialized, so event sequences stay contiguous. */
  readonly commit: Commit;
  readonly writeFailed: () => boolean;
};

export type RunWorkspace = {
  readonly path: string;
  readonly mode: ResolvedWorkspace["digestMode"];
  readonly isWorktreeRun: boolean;
  readonly isProjectRun: boolean;
  readonly commitsRunBranch: boolean;
};

export type TreeFiles = Awaited<ReturnType<typeof gitTreeState>>["files"];
type RunStepRecord = RunRecord["steps"][number];

/** The facts of one claimed attempt that its check, agent and finishing phases all read. */
export type StepFrame = {
  readonly stepId: string;
  readonly definition: RunRecord["snapshot"]["loop"]["steps"][number];
  readonly step: RunStepRecord;
  readonly attempt: RunStepRecord["attempts"][number];
  readonly readonly: boolean;
  readonly executionDirectory: string;
  readonly recovering: boolean;
  readonly copyFailure: string | undefined;
  readonly filesBefore: TreeFiles | null;
  readonly base: string | undefined;
  readonly runChanges: string[] | null;
  readonly inputs: StepInputs;
  readonly beforeFiles: FileSnapshot[] | null;
};

export const createRunContext = (
  project: string,
  runId: string,
  initial: RunRecord,
  signal: AbortSignal,
  resolveAdapter: Resolver,
  onWriteFailure: (error: unknown) => void = () => undefined,
): RunContext => {
  let record: RunRecord = initial;
  let pendingCommit: Promise<void> = Promise.resolve();
  let writeFailed = false;
  const commit: Commit = async (change) => {
    const work = pendingCommit.then(async () => {
      try {
        record = await mutateRun(project, runId, change);
      } catch (error) {
        // Only a failed storage write blocks persistence; a rejected change is a domain error.
        if (isRunPersistenceError(error)) {
          writeFailed = true;
          onWriteFailure(error);
        }
        throw error;
      }
    });
    // Keep this caller's rejection, but let a later interruption/recovery write try again.
    pendingCommit = work.catch(() => undefined);
    await work;
    return record;
  };
  return {
    project,
    runId,
    initial,
    signal,
    resolveAdapter,
    record: () => record,
    setRecord: (next) => {
      record = next;
    },
    commit,
    writeFailed: () => writeFailed,
  };
};
