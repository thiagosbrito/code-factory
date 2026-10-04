import { z } from "zod";
import { executionBindingSchema } from "./loop.js";

export const customAgentSchema = z.strictObject({
  executable: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value),
      "Enter an absolute executable path.",
    ),
  protocol: z.literal("codex-app-server"),
});

export const projectConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(120),
  defaultBinding: executionBindingSchema.nullable(),
  customAgent: customAgentSchema.optional(),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export const projectSetupSchema = z.strictObject({
  name: z.string().trim().min(1, "Enter a project name.").max(120),
  revision: z.string().nullable(),
  defaultBinding: executionBindingSchema.nullable().optional(),
  customAgent: customAgentSchema.nullable().optional(),
});
