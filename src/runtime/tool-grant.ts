import {
  TOOL_GRANT_SCOPE,
  toolGrantInEffect,
  type GrantableProvider,
  type ToolGrantInEffect,
  type ToolGrants,
} from "../domain/tool-grant.js";
import {
  ProjectError,
  readProjectConfig,
  updateProjectConfig,
  type ProjectConfig,
} from "./project.js";

/** Store the provider's fixed scope. Idempotent: an existing grant keeps its original date. */
export const grantToolPermission = (
  directory: string,
  provider: GrantableProvider,
  revision: string | null,
  now = new Date(),
): Promise<ProjectConfig> =>
  updateProjectConfig(directory, revision, (current) => {
    if (!current)
      throw new ProjectError("Save project setup before granting tool permission.", 409);
    if (current.toolGrants?.[provider]) return current;
    const grantedAt = now.toISOString();
    const toolGrants: ToolGrants = {
      ...current.toolGrants,
      ...(provider === "kiro"
        ? { kiro: { scope: [...TOOL_GRANT_SCOPE.kiro], grantedAt } }
        : { codex: { scope: [...TOOL_GRANT_SCOPE.codex], grantedAt } }),
    };
    return { ...current, toolGrants };
  });

/** Remove the provider's grant; drops `toolGrants` when empty. Idempotent without a grant. */
export const revokeToolPermission = (
  directory: string,
  provider: GrantableProvider,
  revision: string | null,
): Promise<ProjectConfig> =>
  updateProjectConfig(directory, revision, (current) => {
    if (!current)
      throw new ProjectError("Save project setup before changing tool permission.", 409);
    if (!current.toolGrants?.[provider]) return current;
    const { [provider]: _removed, ...rest } = current.toolGrants;
    const { toolGrants: _grants, ...withoutGrants } = current;
    return Object.keys(rest).length ? { ...withoutGrants, toolGrants: rest } : withoutGrants;
  });

/** Read the grant for an attempt start. Never throws: an unreadable config fails closed. */
export const resolveToolGrant = async (
  project: string,
  provider: string,
): Promise<{ grant: ToolGrantInEffect | null; note?: string }> => {
  try {
    return { grant: toolGrantInEffect(provider, (await readProjectConfig(project))?.toolGrants) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Tool permission unavailable: ${message}`);
    return { grant: null, note: message };
  }
};
