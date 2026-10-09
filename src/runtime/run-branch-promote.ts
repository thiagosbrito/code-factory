import { realpath } from "node:fs/promises";
import type { RunRecord } from "../domain/run.js";
import { runRecordSchema } from "../domain/run.js";
import { summarizeEvidence } from "../domain/acceptance.js";
import { appendRunEvent, promoteInputSchema, promotionBlocker } from "../domain/run-branch.js";
import { mutateRun, readRun } from "./storage.js";
import { fileDigest } from "./workspace.js";
import { runGit, firstLine, git, withRepoLock, withPromotionLock } from "./run-branch-git.js";
import { validBranchName, suggestBranchName, PromotionError } from "./run-branch-names.js";
import { describeRunWorkspace } from "./run-branch-workspace.js";

export const appendEvent = (
  project: string,
  runId: string,
  title: string,
  detail: string,
  state?: string,
): Promise<RunRecord> =>
  mutateRun(project, runId, (current) =>
    appendRunEvent(current, "lifecycle", title, detail, state),
  );

/**
 * Create a ticket branch at the accepted run branch tip. Create-only (`update-ref <ref> <sha> ""`),
 * so an existing branch is never overwritten; nothing is pushed and no remote is touched.
 */
export const promoteRun = async (
  project: string,
  runId: string,
  input: unknown,
): Promise<{ run: RunRecord; warning?: string }> => {
  const parsed = promoteInputSchema.safeParse(input);
  if (!parsed.success)
    throw new PromotionError(parsed.error.issues[0]?.message ?? "Enter a branch name.", 400);
  const name = parsed.data.branch;
  if (!(await validBranchName(project, name)))
    throw new PromotionError(`${name} is not a valid branch name.`, 400);
  return withPromotionLock(`${project}:${runId}`, async () => {
    const current = await readRun(project, runId);
    if (!current) throw new PromotionError("Run not found.", 404);
    const workspace = await describeRunWorkspace(project, current);
    const present =
      (workspace.kind === "worktree" ||
        (workspace.kind === "project" && workspace.checkout?.onRunBranch)) &&
      workspace.state === "present" &&
      workspace.path
        ? workspace.path
        : null;
    // Read the tip before the acceptance checks so a commit landing during them is refused below.
    const target = present ? (await git(present, "rev-parse", "HEAD")).trim() : null;
    const digest = present ? await fileDigest(present, "git") : null;
    const blocker = promotionBlocker(summarizeEvidence(current, digest), workspace);
    if (blocker || !present || !digest || !target)
      throw new PromotionError(blocker ?? "Run worktree is unavailable.", 409);
    const path = present;
    const branch = current.snapshot.baseline.branch ?? "";
    const head = await runGit(path, ["symbolic-ref", "--quiet", "HEAD"]);
    if (head.code !== 0 || head.stdout.trim() !== `refs/heads/${branch}`)
      throw new PromotionError(`The run's checkout is not on branch ${branch}.`, 409);
    if ((await git(path, "rev-parse", "HEAD")).trim() !== target)
      throw new PromotionError(
        "The run branch moved while Code Factory checked it. Wait for the run to settle and retry.",
        409,
      );
    await appendEvent(project, runId, "ticket-branch-requested", `${name} → ${target}`);
    const fail = async (message: string, suggestedName?: string): Promise<never> => {
      await appendEvent(project, runId, "ticket-branch-failed", message, "failed");
      throw new PromotionError(message, 409, suggestedName);
    };
    const created = await withRepoLock(await realpath(project), () =>
      runGit(project, [
        "update-ref",
        "-m",
        `code-factory: promote run ${runId}`,
        `refs/heads/${name}`,
        target,
        "",
      ]),
    );
    if (created.code !== 0) {
      const existing = await runGit(project, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${name}`,
      ]);
      if (existing.code === 0 && existing.stdout.trim() !== target)
        return fail(
          `Branch ${name} already exists. Choose another name.`,
          await suggestBranchName(project, name),
        );
      if (existing.code !== 0)
        return fail(`Cannot create branch ${name}: ${firstLine(created.stderr)}`);
      // The ref already points at the accepted commit (crash before the record write): adopt it.
    }
    const changed =
      (await fileDigest(path, "git").catch(() => null)) !== digest ||
      (await runGit(path, ["rev-parse", "HEAD"])).stdout.trim() !== target;
    const run = await mutateRun(project, runId, (latest) =>
      appendRunEvent(
        runRecordSchema.parse({
          ...latest,
          promotion: { branch: name, commit: target, createdAt: new Date().toISOString() },
        }),
        "lifecycle",
        "ticket-branch-created",
        `${name} → ${target}`,
        "succeeded",
      ),
    );
    return changed
      ? {
          run,
          warning: `The worktree changed while the branch was being created; ${name} points at the accepted commit ${target.slice(0, 7)}.`,
        }
      : { run };
  });
};
