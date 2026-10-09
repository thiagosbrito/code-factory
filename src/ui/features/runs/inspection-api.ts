import { z } from "zod";
import { api } from "../../shared/project-api";

const changeSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  change: z.enum(["added", "modified", "deleted", "renamed"]),
  attribution: z.enum(["recorded", "uncertain"]),
  receiptId: z.string().optional(),
  stepId: z.string().optional(),
  attemptId: z.string().optional(),
  createdAt: z.string().optional(),
  candidateId: z.string().optional(),
  freshness: z.string().optional(),
});
const filesSchema = z.object({
  baselineRevision: z.string(),
  files: z.array(changeSchema),
  preExisting: z.array(changeSchema),
});
const diffSchema = z.object({ path: z.string(), diff: z.string(), change: changeSchema });
const artifactSchema = z.object({ name: z.string(), mediaType: z.string(), base64: z.string() });
export type InspectedFiles = z.infer<typeof filesSchema>;
export type InspectedChange = z.infer<typeof changeSchema>;
export type InspectedArtifact = z.infer<typeof artifactSchema>;

const root = (runId: string) => `/api/runs/${encodeURIComponent(runId)}/inspection`;
export const listInspectionFiles = (runId: string) =>
  api(root(runId), (value) => filesSchema.parse(value));
export const readInspectionDiff = (runId: string, path: string) =>
  api(`${root(runId)}/diff?path=${encodeURIComponent(path)}`, (value) => diffSchema.parse(value));
export const readInspectionArtifact = (runId: string, id: string) =>
  api(`${root(runId)}/artifact?id=${encodeURIComponent(id)}`, (value) =>
    artifactSchema.parse(value),
  );

export const downloadBytes = (name: string, bytes: Uint8Array, mediaType: string) => {
  const blob = new Blob([new Uint8Array(bytes)], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name.split(/[\\/]/).at(-1) || "artifact";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
export const decodeArtifact = (base64: string) =>
  Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
