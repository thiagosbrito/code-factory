import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { z } from "zod";
import type {
  AgentAdapter,
  AgentConnection,
  AdapterEvent,
  StepExecutionInput,
  StepSession,
} from "./contract.js";
import {
  parseJson,
  PROBE_OUTPUT_LIMIT,
  probeCommand,
  stripAnsi,
  terminateChild,
} from "./process.js";

/** Efforts listed by `claude --help` for `--effort`. */
export const CLAUDE_CODE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
/**
 * The CLI has no model catalog command; these are the aliases it documents for `--model`, each
 * resolving to the latest model of that family. Listing an alias is not proof of entitlement.
 */
export const CLAUDE_CODE_MODELS = [
  { id: "fable", displayName: "Fable (latest)", efforts: [...CLAUDE_CODE_EFFORTS] },
  { id: "opus", displayName: "Opus (latest)", efforts: [...CLAUDE_CODE_EFFORTS] },
  { id: "sonnet", displayName: "Sonnet (latest)", efforts: [...CLAUDE_CODE_EFFORTS] },
  { id: "haiku", displayName: "Haiku (latest)", efforts: [...CLAUDE_CODE_EFFORTS] },
];
/** Tools a read-only reviewer must not have, whatever the user's own settings allow. */
export const CLAUDE_CODE_WRITE_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit"] as const;

/**
 * Non-interactive print-mode arguments. File edits inside the project are accepted, nothing ever
 * waits for a permission prompt, and Bash is denied unless the project holds a Claude Code grant.
 * Deny rules beat allow rules from the user's settings, so a reviewer stays read-only.
 */
export const claudeCodeArgs = (input: StepExecutionInput): string[] => [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--permission-mode",
  "acceptEdits",
  "--permission-prompts",
  "none",
  "--no-session-persistence",
  ...(input.binding.model === "agent-default" ? [] : ["--model", input.binding.model]),
  ...(input.binding.effort ? ["--effort", input.binding.effort] : []),
  ...(input.readOnly
    ? ["--disallowedTools", ...CLAUDE_CODE_WRITE_TOOLS]
    : input.toolGrant?.provider === "claude-code"
      ? ["--allowedTools", ...input.toolGrant.scope]
      : ["--disallowedTools", "Bash"]),
  "--",
  input.instruction,
];

const contentBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string().min(1),
    is_error: z.boolean().optional(),
  }),
  z.object({ type: z.literal("thinking") }),
  z.object({ type: z.literal("redacted_thinking") }),
]);
const message = z.object({
  session_id: z.string().min(1),
  message: z.object({ content: z.union([z.string(), z.array(z.unknown())]) }),
});
const streamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("system"), subtype: z.string(), session_id: z.string().min(1) }),
  message.extend({ type: z.literal("assistant") }),
  message.extend({ type: z.literal("user") }),
  z.object({
    type: z.literal("result"),
    subtype: z.string(),
    is_error: z.boolean(),
    session_id: z.string().min(1),
    result: z.string().optional(),
  }),
]);
const knownTypes = new Set(["system", "assistant", "user", "result"]);

const TOOL_DETAIL_LIMIT = 200;
/** The one input field that tells a reader what a tool call did, never the whole input. */
const toolDetail = (input: unknown): string | undefined => {
  const parsed = z
    .object({
      file_path: z.string().optional(),
      notebook_path: z.string().optional(),
      command: z.string().optional(),
      pattern: z.string().optional(),
      url: z.string().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return undefined;
  const { file_path, notebook_path, command, pattern, url } = parsed.data;
  return (file_path ?? notebook_path ?? command ?? pattern ?? url)?.slice(0, TOOL_DETAIL_LIMIT);
};

/** One `claude -p` stream-json invocation executes one assigned step. It cannot be reattached. */
export class ClaudeCodeAdapter implements AgentAdapter {
  private readonly children = new Set<ReturnType<typeof spawn>>();
  readonly provider = "claude-code" as const;
  readonly capabilities = {
    streaming: "supported",
    steering: "unsupported",
    resume: "unsupported",
    pause: "unsupported",
    waitingInput: "unsupported",
  } as const;

  constructor(
    private readonly executable: string,
    private readonly version: string,
  ) {}

  async inspect(_projectDirectory: string): Promise<AgentConnection> {
    // A signed-out CLI may exit nonzero while still printing its status.
    const output = await probeClaudeCode(this.executable, ["auth", "status", "--json"], {
      allowNonZeroExit: true,
    });
    // Only these two fields are read: account email and organization never leave the CLI.
    const status = z
      .object({ loggedIn: z.boolean(), authMethod: z.string().min(1).optional() })
      .safeParse(parseJson(output));
    if (!status.success)
      throw new Error(
        `claude auth status --json did not print an authentication status: ${stripAnsi(output.trim()).slice(0, PROBE_OUTPUT_LIMIT) || "no output"}`,
      );
    return {
      provider: this.provider,
      executable: this.executable,
      installation: "detected",
      authentication: status.data.loggedIn ? "authenticated" : "unauthenticated",
      authenticationMechanism: status.data.authMethod
        ? `Claude Code login (${status.data.authMethod})`
        : "Claude Code login",
      identity: "Claude Code",
      version: this.version,
      protocol: "claude-code-stream-json",
      capabilities: this.capabilities,
      models: CLAUDE_CODE_MODELS,
    };
  }

  async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    if (signal.aborted) throw new Error("Claude Code execution aborted before launch");
    const child = spawn(this.executable, claudeCodeArgs(input), {
      cwd: input.projectDirectory,
      stdio: ["ignore", "pipe", "pipe"],
      // Claude Code starts tool processes; own its process group so cancellation reaches them.
      detached: process.platform !== "win32",
    });
    const abort = () => terminateChild(child);
    this.children.add(child);
    signal.addEventListener("abort", abort, { once: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, exitSignal) => resolve({ code, signal: exitSignal }));
      },
    );
    let session: StepSession | undefined;
    let completion: { outcome: "succeeded" | "failed"; output: string } | undefined;
    const toolNames = new Map<string, string>();
    try {
      for await (const line of createInterface({ input: child.stdout })) {
        if (!line.trim()) continue;
        const raw = parseJson(line);
        const type = z.object({ type: z.string() }).safeParse(raw);
        if (!type.success) throw new Error("Invalid Claude Code stream event");
        // Rate-limit notices, partial messages and newer event kinds carry nothing a step needs.
        if (!knownTypes.has(type.data.type)) continue;
        const parsed = streamEvent.safeParse(raw);
        if (!parsed.success) throw new Error(`Invalid Claude Code ${type.data.type} event`);
        const event = parsed.data;
        if (!session) {
          if (event.type !== "system" || event.subtype !== "init")
            throw new Error("Claude Code stream did not start with an init event");
          session = {
            runId: input.runId,
            stepId: input.stepId,
            attempt: input.attempt,
            sessionId: event.session_id,
            turnId: randomUUID(),
          };
          yield { type: "started", ...session };
          continue;
        }
        if (event.session_id !== session.sessionId) throw new Error("Claude Code session mismatch");
        if (event.type === "system") continue;
        if (event.type === "result") {
          if (completion) throw new Error("Duplicate Claude Code result event");
          completion = {
            outcome: event.subtype === "success" && !event.is_error ? "succeeded" : "failed",
            output: event.result ?? "",
          };
          continue;
        }
        if (typeof event.message.content === "string") {
          if (event.type === "assistant")
            yield { type: "message", ...session, text: event.message.content };
          continue;
        }
        for (const item of event.message.content) {
          const block = contentBlock.safeParse(item);
          if (!block.success) continue;
          if (block.data.type === "text" && event.type === "assistant") {
            yield { type: "message", ...session, text: block.data.text };
          } else if (block.data.type === "tool_use") {
            toolNames.set(block.data.id, block.data.name);
            const detail = toolDetail(block.data.input);
            yield {
              type: "tool",
              ...session,
              title: block.data.name,
              ...(detail ? { detail } : {}),
              state: "started",
            };
          } else if (block.data.type === "tool_result") {
            yield {
              type: "tool",
              ...session,
              title: toolNames.get(block.data.tool_use_id) ?? "Tool",
              state: block.data.is_error ? "failed" : "completed",
            };
          }
        }
      }
      const exit = await closed;
      if (signal.aborted) throw new Error("Claude Code execution aborted");
      // A failed result is a completed turn even when the CLI exits nonzero for it.
      if (!session || !completion || (exit.code !== 0 && completion.outcome === "succeeded"))
        throw new Error(
          `Claude Code stream ended without successful completion (${exit.code ?? exit.signal ?? "unknown"}): ${stderr}`,
        );
      yield { type: "completed", ...session, ...completion };
    } finally {
      signal.removeEventListener("abort", abort);
      if (child.exitCode === null) terminateChild(child);
      await closed.catch(() => undefined);
      this.children.delete(child);
    }
  }

  attach(_session: StepSession, _signal: AbortSignal): AsyncIterable<AdapterEvent> {
    throw new Error("Claude Code print sessions cannot be resumed");
  }

  async steer(_session: StepSession, _guidance: string): Promise<"unsupported"> {
    return "unsupported";
  }

  close(): void {
    for (const child of this.children) terminateChild(child);
    this.children.clear();
  }
}

export const probeClaudeCode = (
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; allowNonZeroExit?: boolean } = {},
): Promise<string> =>
  probeCommand(executable, args, {
    ...options,
    label: "claude",
    timeoutHint: "Claude Code may be refreshing its sign-in or waiting for the network",
  });

export const createClaudeCodeAdapter = async (executable: string): Promise<ClaudeCodeAdapter> => {
  const stdout = await probeClaudeCode(executable, ["--version"]);
  const version = /(\d+\.\d+\.\d+)\s+\(Claude Code\)/.exec(stdout)?.[1];
  if (!version) throw new Error("Executable is not a supported Claude Code CLI");
  return new ClaudeCodeAdapter(executable, version);
};
