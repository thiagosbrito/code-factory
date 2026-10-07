import { z } from "zod";
import { executionBindingSchema } from "./loop.js";
import { toolGrantsSchema } from "./tool-grant.js";
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
/** Argv only: the setup command never goes through a shell. */
export const setupCommandSchema = z
  .array(
    z
      .string()
      .min(1, "Setup command arguments cannot be empty.")
      .max(4096)
      .refine((value) => !value.includes("\0"), "Setup command arguments cannot contain NUL."),
  )
  .min(1, "Enter a setup command.")
  .max(64);
export type SetupCommand = z.infer<typeof setupCommandSchema>;
export const projectConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(120),
  defaultBinding: executionBindingSchema.nullable(),
  customAgent: customAgentSchema.optional(),
  setupCommand: setupCommandSchema.optional(),
  toolGrants: toolGrantsSchema.optional(),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export const projectSetupSchema = z.strictObject({
  name: z.string().trim().min(1, "Enter a project name.").max(120),
  revision: z.string().nullable(),
  defaultBinding: executionBindingSchema.nullable().optional(),
  customAgent: customAgentSchema.nullable().optional(),
  setupCommand: setupCommandSchema.nullable().optional(),
});

/** Split a command line on whitespace with '…'/"…" grouping. No expansion, escapes or globbing. */
export const parseCommandLine = (
  text: string,
): { ok: true; argv: string[] } | { ok: false; error: string } => {
  const argv: string[] = [];
  let current = "";
  let started = false;
  let quote: "'" | '"' | null = null;
  for (const character of text) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) argv.push(current);
      current = "";
      started = false;
    } else {
      current += character;
      started = true;
    }
  }
  if (quote) return { ok: false, error: "Close the quote in the setup command." };
  if (started) argv.push(current);
  return { ok: true, argv };
};

/** Inverse of parseCommandLine for display: quote arguments that need it. */
export const formatCommandLine = (argv: readonly string[]): string =>
  argv
    .map((value) =>
      value && !/[\s'"]/.test(value)
        ? value
        : value.includes("'")
          ? // Adjacent quoted segments concatenate, so `'it'"'"'s'` parses back to it's.
            value
              .split("'")
              .map((part) => `'${part}'`)
              .join(`"'"`)
          : `'${value}'`,
    )
    .join(" ");
