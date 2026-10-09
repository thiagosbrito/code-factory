import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockAdapter } from "../../src/adapters/mock.js";
import { type AdapterEvent, type StepExecutionInput } from "../../src/adapters/contract.js";
import { parseLoop } from "../../src/domain/loop.js";
import {
  createRunRecord,
  createRunSnapshot,
  type Baseline,
  type RunRecord,
} from "../../src/domain/run.js";
import { shortRunBranch } from "../../src/domain/run-branch.js";
import { createProjectRunBranch } from "../../src/runtime/run-branch.js";
import { createRun } from "../../src/runtime/storage.js";

export const parents: string[] = [];

export const savedEnv = { ...process.env };

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

export const gitStatus = (cwd: string, ...args: string[]): number => {
  try {
    execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
    return 0;
  } catch (error) {
    return error instanceof Error && "status" in error && typeof error.status === "number"
      ? error.status
      : -1;
  }
};

/** A repo inside a disposable parent, so the sibling `<repo>-code-factory` folder is cleaned up. */
export const repository = async (options: { identity?: boolean } = {}) => {
  const parent = await mkdtemp(join(tmpdir(), "factory-branch-"));
  parents.push(parent);
  const root = join(parent, "repo");
  await mkdir(root);
  git(root, "init", "-q", "-b", "main");
  if (options.identity !== false) {
    git(root, "config", "user.name", "Test");
    git(root, "config", "user.email", "test@example.com");
  }
  await writeFile(join(root, "file.txt"), "original\n");
  await writeFile(join(root, "remove.txt"), "remove me\n");
  await writeFile(join(root, ".gitignore"), "node_modules/\n");
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "Initial",
  );
  return { parent, root };
};

/** Status plus each failed step's completion summary, so a failure explains itself. */
export const outcome = (run: RunRecord) => ({
  status: run.status,
  failures: run.steps
    .filter((step) => step.status === "failed")
    .map((step) => {
      const event = [...run.evidence]
        .reverse()
        .find(
          (item) =>
            item.kind === "event" &&
            item.stepId === step.stepId &&
            [
              "completed",
              "Check completed",
              "commit-failed",
              "read-only-violation",
              "execution-interrupted",
            ].includes(item.title),
        );
      return `${step.stepId}: ${event?.kind === "event" ? event.detail : "no summary"}`;
    }),
});

export const loopWith = (
  steps: Record<string, unknown>[],
  dependencies: { from: string; to: string }[],
) =>
  parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps,
    dependencies,
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 1 },
  });

export const implement = {
  id: "implement",
  name: "Implement",
  kind: "agent",
  stage: "implementation",
  role: "dev",
  instruction: "Implement",
};

export const tidy = {
  id: "tidy",
  name: "Tidy",
  kind: "agent",
  stage: "implementation",
  role: "dev",
  instruction: "Tidy",
};

export const review = {
  id: "review",
  name: "Review",
  kind: "agent",
  stage: "review",
  role: "reviewer",
  instruction: "Review",
};

export const storeRun = (
  root: string,
  loop: ReturnType<typeof loopWith>,
  baseline: Baseline,
  runId: string,
  options: { ticketId?: string; setupCommand?: string[] },
) =>
  createRun(
    root,
    createRunRecord(
      createRunSnapshot(
        loop,
        options.ticketId
          ? { description: "", ticketId: options.ticketId }
          : { description: "Task" },
        { provider: "mock", model: "default" },
        baseline,
        runId,
        options.setupCommand,
      ),
    ),
  );

/** A new run: a branch in the project itself, with the checkout switched to it. */
export const createProjectRun = async (
  root: string,
  loop = loopWith([implement, review], [{ from: "implement", to: "review" }]),
  options: { ticketId?: string; setupCommand?: string[]; branch?: string } = {},
): Promise<RunRecord> => {
  const runId = crypto.randomUUID();
  const baseline = await createProjectRunBranch(root, {
    branch: options.branch ?? (options.ticketId || shortRunBranch(runId)),
  });
  return storeRun(root, loop, baseline, runId, options);
};

/** A run created by the removed worktree mode, rebuilt with plain Git for legacy coverage. */
export const createLegacyWorktreeRun = async (
  root: string,
  loop = loopWith([implement, review], [{ from: "implement", to: "review" }]),
): Promise<RunRecord> => {
  const runId = crypto.randomUUID();
  const branch = shortRunBranch(runId);
  const revision = git(root, "rev-parse", "HEAD");
  await mkdir(join(root, "..", "repo-code-factory"), { recursive: true });
  git(root, "worktree", "add", "-q", "-b", branch, join(root, "..", "repo-code-factory", runId));
  return storeRun(
    root,
    loop,
    {
      id: crypto.randomUUID(),
      kind: "git",
      revision,
      sourceRevision: revision,
      capturedAt: new Date().toISOString(),
      workspace: `../repo-code-factory/${runId}`,
      branch,
      changes: [],
    },
    runId,
    {},
  );
};

export const worktreeOf = (root: string, run: RunRecord) =>
  join(root, run.snapshot.baseline.workspace ?? "");

/** Mock adapter that runs `act` in the step's directory before completing like the mock. */
export const acting = (act: (input: StepExecutionInput) => Promise<void>) => ({
  ...mockAdapter,
  async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    await act(input);
    yield* mockAdapter.execute(input, signal);
  },
});

export const writer = acting(async (input) => {
  if (input.stepId === "implement")
    await writeFile(join(input.projectDirectory, "feature.txt"), `${input.stepId}\n`);
});
