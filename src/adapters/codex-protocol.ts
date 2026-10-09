import { z } from "zod";

export const rpcMessageSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

export type RpcMessage = z.infer<typeof rpcMessageSchema>;

export type RpcListener = (message: RpcMessage) => boolean | void;

export const inputRequestSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  itemId: z.string().min(1),
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        header: z.string(),
        question: z.string().min(1),
        options: z.array(z.object({ label: z.string(), description: z.string() })).default([]),
      }),
    )
    .min(1),
  isBlocking: z.boolean(),
  autoResolutionMs: z.number().int().nonnegative().nullable(),
});

export const parseCodexMessage = (line: string): RpcMessage =>
  rpcMessageSchema.parse(JSON.parse(line));

export const claimCodexInputRequest = (
  listeners: Iterable<RpcListener>,
  request: RpcMessage,
): boolean => {
  let claimed = false;
  for (const listener of listeners) claimed = listener(request) === true || claimed;
  return claimed;
};

export type RpcDispatch = {
  response(message: RpcMessage): void;
  notification(message: RpcMessage): void;
  userInputRequest?(message: RpcMessage): boolean;
  send(message: Record<string, unknown>): void;
  approveFileChange?(request: RpcMessage): boolean;
  approveCommandExecution?(request: RpcMessage): boolean;
};

/** Route app-server messages, declining approvals and rejecting unknown requests by default. */
export const dispatchCodexMessage = (message: RpcMessage, handlers: RpcDispatch): void => {
  if (message.method && (typeof message.id === "number" || typeof message.id === "string")) {
    const approvalMethods = new Set([
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
    ]);
    if (approvalMethods.has(message.method)) {
      let decision = "decline";
      try {
        if (
          message.method === "item/fileChange/requestApproval"
            ? handlers.approveFileChange?.(message) === true
            : handlers.approveCommandExecution?.(message) === true
        )
          decision = "accept";
      } catch {
        /* Keep the default denial. */
      }
      handlers.send({ jsonrpc: "2.0", id: message.id, result: { decision } });
    } else if (
      message.method === "item/tool/requestUserInput" &&
      handlers.userInputRequest?.(message)
    ) {
      return;
    } else {
      handlers.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Unsupported Codex server request: ${message.method}` },
      });
    }
    return;
  }
  if (message.method) handlers.notification(message);
  else if (typeof message.id === "number" || typeof message.id === "string")
    handlers.response(message);
};

export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Codex response");
  return z.record(z.string(), z.unknown()).parse(value);
};

export const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !value) throw new Error("Missing Codex identity");
  return value;
};

export const textInput = (text: string) => {
  return [{ type: "text", text, text_elements: [] }];
};

export interface CodexRpc {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): void;
  subscribe(listener: RpcListener): () => void;
  replyToInput?(id: string | number, answers: Record<string, { answers: string[] }>): void;
  close?(): void;
}
