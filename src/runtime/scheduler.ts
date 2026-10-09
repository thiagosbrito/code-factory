import type { RunRecord } from "../domain/run.js";
import { resolveRunWorkspace } from "./workspace.js";

export { fileDigest } from "./workspace.js";
export { agentNotConnected } from "./scheduler-inputs.js";
export { cancelRun, executeRun, isRunActive, retryStep, withIdleRunSlot } from "./run-slots.js";

export const workspaceFor = async (project: string, record: RunRecord): Promise<string> =>
  (await resolveRunWorkspace(project, record, { legacy: "prefix" })).path;
