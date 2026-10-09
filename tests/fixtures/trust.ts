import type { ToolGrants } from "../../src/domain/tool-grant.js";
import type { ProjectTrust, TrustReview } from "../../src/domain/trust.js";

export const emptyTrustReview: TrustReview = {
  setupCommand: null,
  runSetupCommands: [],
  customExecutable: null,
  checkCommands: [],
  interruptedRuns: 0,
};

/** The trust part of a project response; trusted unless `trusted: false`. */
export const trustState = (
  options: { trusted?: boolean; toolGrants?: ToolGrants; review?: TrustReview } = {},
): ProjectTrust => ({
  trusted: options.trusted ?? true,
  trustedAt: options.trusted === false ? null : "2026-10-07T09:00:00.000Z",
  toolGrants: options.toolGrants ?? {},
  review: options.review ?? emptyTrustReview,
});
