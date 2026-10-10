import { z } from "zod";

export const connectionRequestSchema = z.discriminatedUnion("provider", [
  z.strictObject({ provider: z.literal("codex"), launch: z.literal(true) }),
  z.strictObject({ provider: z.literal("kiro"), launch: z.literal(true) }),
  z.strictObject({ provider: z.literal("claude-code"), launch: z.literal(true) }),
  z.strictObject({
    provider: z.literal("custom"),
    launch: z.literal(true),
    executable: z.string().trim().min(1),
    protocol: z.literal("codex-app-server"),
  }),
]);
export type ConnectionRequest = z.infer<typeof connectionRequestSchema>;
