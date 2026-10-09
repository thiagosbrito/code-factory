import { toolGrantInEffect, type ToolGrantInEffect } from "../domain/tool-grant.js";
import { readProjectTrust } from "./trust.js";

/**
 * Read the grant for an attempt start from the user's trust store, never from the project, so a
 * cloned repository cannot grant its own agents tools. Never throws: an unreadable store fails
 * closed.
 */
export const resolveToolGrant = async (
  project: string,
  provider: string,
): Promise<{ grant: ToolGrantInEffect | null; note?: string }> => {
  try {
    return { grant: toolGrantInEffect(provider, (await readProjectTrust(project))?.toolGrants) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Tool permission unavailable: ${message}`);
    return { grant: null, note: message };
  }
};
