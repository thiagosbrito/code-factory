import { ProjectError } from "./project.js";
import { runGit } from "./run-branch-git.js";

export const branchExists = async (project: string, branch: string): Promise<boolean> =>
  (await runGit(project, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;

export const validBranchName = async (project: string, name: string): Promise<boolean> => {
  const result = await runGit(project, ["check-ref-format", "--branch", name]);
  return result.code === 0 && result.stdout.trim() === name;
};

/** First free `<name>-<n>` so a refusal can offer a name instead of overwriting a branch. */
export const suggestBranchName = async (
  project: string,
  name: string,
): Promise<string | undefined> => {
  for (let index = 2; index <= 20; index += 1) {
    const candidate = `${name}-${index}`;
    if ((await validBranchName(project, candidate)) && !(await branchExists(project, candidate)))
      return candidate;
  }
  return undefined;
};

export class BranchNameError extends ProjectError {
  constructor(
    message: string,
    status: number,
    readonly suggestedName?: string,
  ) {
    super(message, status);
  }
}

/** Promotion refusals carry an optional free name, like a refused run branch. */
export class PromotionError extends BranchNameError {}
