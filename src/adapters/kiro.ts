import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  AgentAdapter,
  AgentConnection,
  AdapterEvent,
  StepExecutionInput,
  StepSession,
} from "./contract.js";

const streamEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("runStarted"),
    data: z.object({ payloadSchema: z.literal("acp"), acpProtocolVersion: z.literal(1) }),
  }),
  z.object({ type: z.literal("metadata"), data: z.object({ sessionId: z.string().min(1) }) }),
  z.object({
    type: z.literal("sessionUpdate"),
    data: z.object({
      sessionId: z.string().min(1),
      update: z.object({
        sessionUpdate: z.string(),
        content: z.unknown().optional(),
        title: z.string().optional(),
        status: z.string().optional(),
      }),
    }),
  }),
  z.object({
    type: z.literal("runFinished"),
    data: z.object({
      sessionId: z.string().min(1),
      status: z.string(),
      finalText: z.string().optional(),
    }),
  }),
  z.object({ type: z.literal("runError"), data: z.unknown() }),
]);

/** A Kiro v2 stream-json invocation executes one assigned step. Its session cannot be reattached. */
export class KiroAdapter implements AgentAdapter {
  private readonly children = new Set<ReturnType<typeof spawn>>();
  readonly provider = "kiro" as const;
  readonly capabilities = {
    streaming: "supported",
    steering: "unsupported",
    resume: "unsupported",
  } as const;

  constructor(
    private readonly executable: string,
    private readonly version: string,
  ) {}

  async inspect(_projectDirectory: string): Promise<AgentConnection> {
    const { stdout } = await promisify(execFile)(this.executable, ["whoami", "--format", "json"], {
      timeout: 5000,
    });
    const identityLine = stdout.split(/\r?\n/).find((line) => line.trim().startsWith("{"));
    if (!identityLine) throw new Error("Kiro identity response is empty");
    const identity = z.object({ accountType: z.string().min(1) }).parse(JSON.parse(identityLine));
    if (!identity.accountType) throw new Error("Kiro identity response is empty");
    const catalogResponse = await promisify(execFile)(
      this.executable,
      ["chat", "--list-models", "--format", "json"],
      { timeout: 10000, cwd: _projectDirectory },
    );
    const catalog = z
      .object({
        models: z.array(z.object({ model_id: z.string().min(1), model_name: z.string().min(1) })),
      })
      .parse(JSON.parse(catalogResponse.stdout));
    return {
      provider: this.provider,
      executable: this.executable,
      installation: "detected",
      authentication: "authenticated",
      authenticationMechanism: "Kiro CLI session",
      identity: "Kiro CLI",
      version: this.version,
      protocol: "kiro-v2-stream-json",
      capabilities: this.capabilities,
      models: catalog.models.map((model) => ({
        id: model.model_id,
        displayName: model.model_name,
      })),
    };
  }

  async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    if (signal.aborted) throw new Error("Kiro execution aborted before launch");
    if (input.binding.effort)
      throw new Error("Kiro does not advertise supported effort choices in its model catalog");
    const child = spawn(
      this.executable,
      [
        "chat",
        "--agent-engine",
        "v2",
        "--output-format",
        "stream-json",
        "--no-interactive",
        "--trust-tools=fs_read,fs_write",
        ...(input.binding.model === "agent-default" ? [] : ["--model", input.binding.model]),
        input.instruction,
      ],
      {
        cwd: input.projectDirectory,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const abort = () => child.kill();
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
    let output = "";
    let completion: { outcome: "succeeded" | "failed"; output: string } | undefined;
    try {
      for await (const line of createInterface({ input: child.stdout })) {
        let event: z.infer<typeof streamEvent>;
        try {
          event = streamEvent.parse(JSON.parse(line));
        } catch {
          throw new Error("Invalid Kiro v2 stream event");
        }
        if (event.type === "runStarted") continue;
        if (event.type === "runError") throw new Error("Kiro native session failed");
        if (event.type === "metadata") {
          if (session) {
            if (event.data.sessionId !== session.sessionId)
              throw new Error("Kiro session mismatch");
            continue;
          }
          session = {
            runId: input.runId,
            stepId: input.stepId,
            attempt: input.attempt,
            sessionId: event.data.sessionId,
            turnId: randomUUID(),
          };
          yield { type: "started", ...session };
          continue;
        }
        if (!session || event.data.sessionId !== session.sessionId)
          throw new Error("Kiro session mismatch");
        if (event.type === "sessionUpdate") {
          const update = event.data.update;
          const message = z
            .object({ type: z.literal("text"), text: z.string() })
            .safeParse(update.content);
          if (update.sessionUpdate === "agent_message_chunk" && message.success) {
            output += message.data.text;
            yield { type: "message", ...session, text: message.data.text };
          } else if (
            (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") &&
            update.title
          ) {
            // Kiro finalText concatenates pre-tool commentary and the final answer.
            // Review verdicts must use the answer following the final tool boundary.
            output = "";
            yield {
              type: "tool",
              ...session,
              title: update.title,
              ...(update.status ? { state: update.status } : {}),
            };
          }
          continue;
        }
        if (completion) throw new Error("Duplicate Kiro completion event");
        completion = {
          outcome: event.data.status === "success" ? "succeeded" : "failed",
          output: output || event.data.finalText || "",
        };
      }
      const exit = await closed;
      if (signal.aborted) throw new Error("Kiro execution aborted");
      if (!session || !completion || exit.code !== 0)
        throw new Error(
          `Kiro stream ended without successful completion (${exit.code ?? exit.signal ?? "unknown"}): ${stderr}`,
        );
      yield { type: "completed", ...session, ...completion };
    } finally {
      signal.removeEventListener("abort", abort);
      if (!child.killed && child.exitCode === null) child.kill();
      await closed.catch(() => undefined);
      this.children.delete(child);
    }
  }

  attach(_session: StepSession, _signal: AbortSignal): AsyncIterable<AdapterEvent> {
    throw new Error("Kiro stream sessions cannot be resumed");
  }

  async steer(_session: StepSession, _guidance: string): Promise<"unsupported"> {
    return "unsupported";
  }

  close(): void {
    for (const child of this.children) child.kill();
    this.children.clear();
  }
}

export const createKiroAdapter = async (executable: string): Promise<KiroAdapter> => {
  const { stdout } = await promisify(execFile)(executable, ["--version"], { timeout: 5000 });
  const version = /kiro-cli\s+(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
  if (!version) throw new Error("Executable is not a supported Kiro CLI");
  return new KiroAdapter(executable, version);
};
