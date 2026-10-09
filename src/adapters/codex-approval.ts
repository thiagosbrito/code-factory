import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import type { ToolGrantInEffect } from "../domain/tool-grant.js";

export type CodexThreadPolicy = { grant: ToolGrantInEffect | null; root: string };

export const commandApprovalSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  cwd: z.string().nullable().optional(),
  kind: z.enum(["command", "writeStdin"]).optional().default("command"),
  networkApprovalContext: z.unknown().optional(),
});

/**
 * Accept a command approval only with a Codex project grant, for a plain command (not stdin to a
 * terminal, not a network prompt) whose real working directory is inside the step's directory.
 */
export const decideCommandApproval = (
  params: unknown,
  policy: CodexThreadPolicy | undefined,
): "accept" | "decline" => {
  const parsed = commandApprovalSchema.safeParse(params);
  if (!parsed.success || policy?.grant?.provider !== "codex") return "decline";
  const { kind, networkApprovalContext, cwd } = parsed.data;
  if (kind !== "command") return "decline";
  if (networkApprovalContext !== undefined && networkApprovalContext !== null) return "decline";
  if (!cwd || !isAbsolute(cwd)) return "decline";
  let real: string;
  try {
    real = realpathSync.native(cwd);
  } catch {
    return "decline";
  }
  const offset = relative(policy.root, real);
  return offset.startsWith("..") || isAbsolute(offset) ? "decline" : "accept";
};
