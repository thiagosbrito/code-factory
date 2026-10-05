import { z } from "zod";

export const projectRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") &&
      !/^[a-z]:/i.test(path),
    "Use a normalized project-relative path without parent traversal.",
  );
const identity = {
  id: z.uuid(),
  runId: z.uuid(),
  stepId: z.string().optional(),
  attemptId: z.uuid().optional(),
  createdAt: z.iso.datetime(),
};
export const provenanceSchema = z.strictObject({
  source: z.enum(["agent", "check", "human", "factory"]),
  baselineId: z.string().min(1),
  candidateId: z.string().min(1),
  inputReceiptIds: z.array(z.uuid()).default([]),
});
export const freshnessSchema = z.strictObject({
  state: z.enum(["current", "superseded", "unknown"]),
  checkedAgainstCandidateId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
});
export const eventSchema = z.strictObject({
  ...identity,
  kind: z.literal("event"),
  type: z.enum(["lifecycle", "message", "tool", "check", "error", "guidance"]),
  title: z.string().min(1),
  detail: z.string().optional(),
  state: z.string().optional(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  sequence: z.number().int().nonnegative(),
});
export const guidanceSchema = z.strictObject({
  ...identity,
  kind: z.literal("guidance"),
  messageId: z.uuid(),
  stepId: z.string().min(1),
  attemptId: z.uuid(),
  message: z.string().trim().min(1),
  state: z.enum(["queued", "delivered", "acknowledged", "rejected"]),
  acknowledgedAt: z.iso.datetime().optional(),
  reason: z.string().min(1).optional(),
  replyEventId: z.uuid().optional(),
});
export const checkReceiptSchema = z.strictObject({
  ...identity,
  kind: z.literal("check"),
  stepId: z.string().min(1),
  attemptId: z.uuid(),
  command: z.string().trim().min(1),
  outcome: z.enum(["passed", "failed", "skipped"]),
  exitCode: z.number().int().nullable(),
  summary: z.string(),
  provenance: provenanceSchema,
  freshness: freshnessSchema,
});
export const reviewReceiptSchema = z.strictObject({
  ...identity,
  kind: z.literal("review"),
  stepId: z.string().min(1),
  attemptId: z.uuid(),
  scope: z.string().min(1),
  verdict: z.enum(["pass", "changes-requested", "blocked"]),
  findings: z.array(z.string().min(1)),
  inputHash: z.string().min(1).optional(),
  provenance: provenanceSchema,
  freshness: freshnessSchema,
});
export const outputSchema = z.strictObject({
  ...identity,
  kind: z.literal("output"),
  stepId: z.string().min(1),
  attemptId: z.uuid(),
  name: z.string().min(1),
  mediaType: z.string().min(1),
  relativePath: projectRelativePathSchema.optional(),
  digest: z.string().min(1),
  provenance: provenanceSchema,
  freshness: freshnessSchema,
});
export const fileChangeSchema = z.strictObject({
  ...identity,
  kind: z.literal("file"),
  stepId: z.string().min(1),
  attemptId: z.uuid(),
  path: projectRelativePathSchema,
  change: z.enum(["added", "modified", "deleted", "renamed"]),
  previousPath: projectRelativePathSchema.optional(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  diffDigest: z.string().min(1),
  provenance: provenanceSchema,
  freshness: freshnessSchema,
});
export const artifactSchema = z.strictObject({
  ...identity,
  kind: z.literal("artifact"),
  stepId: z.string().min(1),
  attemptId: z.uuid(),
  name: z.string().min(1),
  mediaType: z.string().min(1),
  relativePath: projectRelativePathSchema,
  digest: z.string().min(1),
  provenance: provenanceSchema,
  freshness: freshnessSchema,
});
export const evidenceSchema = z.discriminatedUnion("kind", [
  eventSchema,
  guidanceSchema,
  checkReceiptSchema,
  reviewReceiptSchema,
  outputSchema,
  fileChangeSchema,
  artifactSchema,
]);
export type Evidence = z.infer<typeof evidenceSchema>;
