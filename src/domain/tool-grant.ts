import { z } from "zod";
import type { RunRecord } from "./run.js";

export const GRANTABLE_PROVIDERS = ["kiro", "codex", "claude-code"] as const;
export const grantableProviderSchema = z.enum(GRANTABLE_PROVIDERS);
export type GrantableProvider = z.infer<typeof grantableProviderSchema>;
// The only scopes that exist. Widening a scope is a code change, never a config edit.
export const TOOL_GRANT_SCOPE = {
  kiro: ["execute_bash"],
  codex: ["commandExecution"],
  "claude-code": ["Bash"],
} as const;
export const KIRO_DEFAULT_TRUSTED_TOOLS = ["fs_read", "fs_write"] as const;
/** A read-only reviewer trusts reading only, whatever the project grant says. */
export const KIRO_READ_ONLY_TRUSTED_TOOLS = ["fs_read"] as const;
export const TOOL_PERMISSION = "Tool permission";

const grantedAt = z.iso.datetime();
export const toolGrantsSchema = z.strictObject({
  kiro: z.strictObject({ scope: z.tuple([z.literal("execute_bash")]), grantedAt }).optional(),
  codex: z.strictObject({ scope: z.tuple([z.literal("commandExecution")]), grantedAt }).optional(),
  "claude-code": z.strictObject({ scope: z.tuple([z.literal("Bash")]), grantedAt }).optional(),
});
export type ToolGrants = z.infer<typeof toolGrantsSchema>;
export const toolGrantInEffectSchema = z.discriminatedUnion("provider", [
  z.strictObject({
    provider: z.literal("kiro"),
    scope: z.tuple([z.literal("execute_bash")]),
    grantedAt,
  }),
  z.strictObject({
    provider: z.literal("codex"),
    scope: z.tuple([z.literal("commandExecution")]),
    grantedAt,
  }),
  z.strictObject({
    provider: z.literal("claude-code"),
    scope: z.tuple([z.literal("Bash")]),
    grantedAt,
  }),
]);
export type ToolGrantInEffect = z.infer<typeof toolGrantInEffectSchema>;
export const toolGrantRequestSchema = z.strictObject({
  provider: grantableProviderSchema,
  revision: z.string().nullable(),
  acknowledged: z.literal(true),
});
export const toolGrantRevokeSchema = z.strictObject({ revision: z.string().nullable() });

export const isGrantableProvider = (provider: string): provider is GrantableProvider =>
  (GRANTABLE_PROVIDERS as readonly string[]).includes(provider);

export const toolGrantInEffect = (
  provider: string,
  grants: ToolGrants | undefined,
): ToolGrantInEffect | null => {
  if (provider === "kiro" && grants?.kiro) return { provider: "kiro", ...grants.kiro };
  if (provider === "codex" && grants?.codex) return { provider: "codex", ...grants.codex };
  if (provider === "claude-code" && grants?.["claude-code"])
    return { provider: "claude-code", ...grants["claude-code"] };
  return null;
};

/** Grantable providers bound to agent steps of this run that have no stored grant. */
export const providersNeedingToolGrant = (
  run: RunRecord,
  grants: ToolGrants | undefined,
): GrantableProvider[] => {
  const bound = new Set(
    run.snapshot.loop.steps
      .filter((step) => step.kind === "agent")
      .map((step) => run.snapshot.bindings[step.id]?.provider)
      .filter((provider) => provider !== undefined),
  );
  return GRANTABLE_PROVIDERS.filter(
    (provider) => bound.has(provider) && !toolGrantInEffect(provider, grants),
  );
};

const kiroTools = (grant: boolean) =>
  [...KIRO_DEFAULT_TRUSTED_TOOLS, ...(grant ? TOOL_GRANT_SCOPE.kiro : [])].join(", ");

/** Evidence text naming which permission an attempt started with. */
export const describeToolGrant = (
  provider: string,
  grant: ToolGrantInEffect | null,
  executionDirectory: string,
  note?: string,
): string => {
  const suffix = note ? ` Tool permission unavailable: ${note}.` : "";
  if (provider === "kiro")
    return grant?.provider === "kiro"
      ? `Kiro project grant from ${grant.grantedAt}: trusted tools ${kiroTools(true)}.`
      : `Kiro default: trusted tools ${kiroTools(false)}. Shell (execute_bash) is not trusted.${suffix}`;
  if (provider === "codex")
    return grant?.provider === "codex"
      ? `Codex project grant from ${grant.grantedAt}: command approval requests are accepted only when the command's working directory is inside ${executionDirectory} (an accepted command runs unsandboxed); network-access prompts and file-change approvals are declined.`
      : `Codex default: command approval requests are declined.${suffix}`;
  if (provider === "claude-code")
    return grant?.provider === "claude-code"
      ? `Claude Code project grant from ${grant.grantedAt}: file tools and Bash allowed.`
      : `Claude Code default: file tools allowed. Bash is denied.${suffix}`;
  return `No tool permission grant applies to provider ${provider}.`;
};
