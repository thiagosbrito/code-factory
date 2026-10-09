import { z } from "zod";
import { toolGrantsSchema } from "./tool-grant.js";

/**
 * Project trust lives in the user's own configuration, never in the project: a cloned repository
 * cannot mark itself trusted or grant its agents tools. Until the user trusts a project, Code
 * Factory runs nothing from it (no check or setup command, no agent step, no custom executable).
 */
export const projectTrustEntrySchema = z.strictObject({
  trustedAt: z.iso.datetime(),
  toolGrants: toolGrantsSchema.optional(),
});
export type ProjectTrustEntry = z.infer<typeof projectTrustEntrySchema>;
export const trustFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projects: z.record(z.string().min(1), projectTrustEntrySchema),
});
export type TrustFile = z.infer<typeof trustFileSchema>;

/** What the project's own files would make Code Factory run once trusted. */
export const trustReviewSchema = z.strictObject({
  setupCommand: z.array(z.string()).nullable(),
  /** Setup commands frozen into run snapshots, which can differ from the project's current one. */
  runSetupCommands: z.array(z.strictObject({ loop: z.string(), command: z.array(z.string()) })),
  customExecutable: z.string().nullable(),
  checkCommands: z.array(
    z.strictObject({ loop: z.string(), step: z.string(), command: z.string() }),
  ),
  interruptedRuns: z.number().int().nonnegative(),
});
export type TrustReview = z.infer<typeof trustReviewSchema>;
export const projectTrustSchema = z.strictObject({
  trusted: z.boolean(),
  trustedAt: z.iso.datetime().nullable(),
  toolGrants: toolGrantsSchema,
  review: trustReviewSchema,
});
export type ProjectTrust = z.infer<typeof projectTrustSchema>;
export const trustRequestSchema = z.strictObject({ acknowledged: z.literal(true) });
