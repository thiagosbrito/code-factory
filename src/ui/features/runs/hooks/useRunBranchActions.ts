import {
  ApiError,
  api,
  jsonPost,
  promoteErrorSchema,
  promoteResponseSchema,
  runResponseSchema,
} from "../../../shared/project-api";
import type { PromoteFailure } from "../PromoteRunDialog";
import { mergeRun, type SetRuns } from "./run-updates";

/** Git actions on a run's branch and worktree; each returns what the dialog should show. */
export const useRunBranchActions = (
  setRuns: SetRuns,
  refreshWorkspace: (id: string) => Promise<void>,
) => {
  const promote = async (
    id: string,
    branch: string,
  ): Promise<PromoteFailure | { warning?: string }> => {
    try {
      const { run, warning } = await api(
        `/api/runs/${id}/promote`,
        promoteResponseSchema.parse,
        jsonPost("POST", { branch }),
      );
      setRuns((previous) => mergeRun(previous, id, run));
      await refreshWorkspace(id).catch(() => undefined);
      return warning ? { warning } : {};
    } catch (error) {
      if (error instanceof ApiError) {
        const body = promoteErrorSchema.safeParse(error.body);
        return body.success ? body.data : { error: error.message };
      }
      return { error: "Connection lost. The branch may not have been created; reload the run." };
    }
  };

  const postRunAction = async (
    id: string,
    path: string,
    lostMessage: string,
  ): Promise<string | null> => {
    try {
      const { run } = await api(`/api/runs/${id}/${path}`, runResponseSchema.parse, {
        method: "POST",
      });
      setRuns((previous) => mergeRun(previous, id, run));
      await refreshWorkspace(id).catch(() => undefined);
      return null;
    } catch (error) {
      return error instanceof ApiError ? error.message : lostMessage;
    }
  };

  const returnCheckout = (id: string) =>
    postRunAction(
      id,
      "checkout/return",
      "Connection lost. The checkout state is unknown; reload the run.",
    );
  const removeWorktree = (id: string) =>
    postRunAction(
      id,
      "worktree/remove",
      "Connection lost. Removal state is unknown; reload the run.",
    );

  return { promote, returnCheckout, removeWorktree };
};
