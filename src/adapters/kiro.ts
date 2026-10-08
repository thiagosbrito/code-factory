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
import { KIRO_DEFAULT_TRUSTED_TOOLS, KIRO_READ_ONLY_TRUSTED_TOOLS } from "../domain/tool-grant.js";

/**
 * Non-interactive chat arguments. Only the trusted-tool list varies: a read-only reviewer trusts
 * fs_read alone, a project Kiro grant adds its exact scope otherwise; trust-all is never emitted.
 */
export const kiroChatArgs = (input: StepExecutionInput): string[] => [
  "chat",
  "--agent-engine",
  "v2",
  "--output-format",
  "stream-json",
  "--no-interactive",
  `--trust-tools=${(input.readOnly
    ? [...KIRO_READ_ONLY_TRUSTED_TOOLS]
    : [
        ...KIRO_DEFAULT_TRUSTED_TOOLS,
        ...(input.toolGrant?.provider === "kiro" ? input.toolGrant.scope : []),
      ]
  ).join(",")}`,
  ...(input.binding.model === "agent-default" ? [] : ["--model", input.binding.model]),
  input.instruction,
];
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

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** SSO sign-ins can refresh their token over the network during whoami, which takes seconds. */
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_OUTPUT_LIMIT = 600;

// oxlint-disable-next-line no-control-regex -- ANSI escape sequences are exactly what is removed.
const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

/**
 * Run a short Kiro CLI command with stdin closed. A failure names the command and says whether it
 * timed out, exited with a code or was killed by a signal, followed by Kiro's own output, so
 * Settings can show the real cause instead of a bare "Command failed".
 */
export const probeKiro = (
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<string> =>
  new Promise((resolve, reject) => {
    const command = `kiro-cli ${args.join(" ")}`;
    const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
    const child = spawn(executable, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `${command} could not start: ${"code" in error && typeof error.code === "string" ? error.code : error.message}`,
        ),
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const output = stripAnsi(stderr.trim() || stdout.trim()).slice(-PROBE_OUTPUT_LIMIT);
      if (timedOut)
        reject(
          new Error(
            `${command} did not finish within ${timeoutMs / 1000} s. Kiro may be refreshing its sign-in or waiting for the network; run \`${command}\` in a terminal to check.${output ? `\n${output}` : ""}`,
          ),
        );
      else if (code !== 0)
        reject(
          new Error(
            `${command} ${code === null ? `was stopped by ${signal ?? "a signal"}` : `exited with code ${code}`}: ${output || "no output"}`,
          ),
        );
      else resolve(stdout);
    });
  });

const terminateChild = (child: ReturnType<typeof spawn>): void => {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill();
    else process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
    throw error;
  }
};

/** A Kiro v2 stream-json invocation executes one assigned step. Its session cannot be reattached. */
export class KiroAdapter implements AgentAdapter {
  private readonly children = new Set<ReturnType<typeof spawn>>();
  readonly provider = "kiro" as const;
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

  async inspect(projectDirectory: string): Promise<AgentConnection> {
    const whoami = await probeKiro(this.executable, ["whoami", "--format", "json"]);
    // SSO accounts print the JSON identity followed by profile lines, so read the JSON line only.
    const identityLine = whoami.split(/\r?\n/).find((line) => line.trim().startsWith("{"));
    const identity = z
      .object({ accountType: z.string().min(1) })
      .safeParse(identityLine ? parseJson(identityLine) : undefined);
    if (!identity.success)
      throw new Error(
        `kiro-cli whoami --format json did not print a Kiro identity: ${stripAnsi(whoami.trim()).slice(0, PROBE_OUTPUT_LIMIT) || "no output"}`,
      );
    const catalogOutput = await probeKiro(
      this.executable,
      ["chat", "--list-models", "--format", "json"],
      { cwd: projectDirectory },
    );
    const catalog = z
      .object({
        models: z.array(z.object({ model_id: z.string().min(1), model_name: z.string().min(1) })),
      })
      .safeParse(parseJson(catalogOutput));
    if (!catalog.success)
      throw new Error(
        `kiro-cli chat --list-models --format json did not print a model catalog: ${stripAnsi(catalogOutput.trim()).slice(0, PROBE_OUTPUT_LIMIT) || "no output"}`,
      );
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
      models: catalog.data.models.map((model) => ({
        id: model.model_id,
        displayName: model.model_name,
      })),
    };
  }

  async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    if (signal.aborted) throw new Error("Kiro execution aborted before launch");
    if (input.binding.effort)
      throw new Error("Kiro does not advertise supported effort choices in its model catalog");
    const child = spawn(this.executable, kiroChatArgs(input), {
      cwd: input.projectDirectory,
      stdio: ["ignore", "pipe", "pipe"],
      // Kiro launches a second process; own its process group so cancellation reaches both.
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
      if (child.exitCode === null) terminateChild(child);
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
    for (const child of this.children) terminateChild(child);
    this.children.clear();
  }
}

export const createKiroAdapter = async (executable: string): Promise<KiroAdapter> => {
  const stdout = await probeKiro(executable, ["--version"]);
  const version = /kiro-cli\s+(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
  if (!version) throw new Error("Executable is not a supported Kiro CLI");
  return new KiroAdapter(executable, version);
};
