import { type CodexRpc } from "../../src/adapters/codex.js";
import {
  type AgentAdapter,
  type AdapterEvent,
  type StepExecutionInput,
} from "../../src/adapters/contract.js";

export type Notification = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
};

export class FixtureRpc implements CodexRpc {
  constructor(
    private readonly failFirst = false,
    private readonly recoveryActive = false,
    private readonly requestInput = false,
    private readonly interruptFailure = "",
  ) {}
  calls: { method: string; params: Record<string, unknown> }[] = [];
  private listeners = new Set<(message: Notification) => void>();
  private nextThread = 0;
  notify(method: string, params: Record<string, unknown> = {}) {
    this.calls.push({ method, params });
  }
  subscribe(listener: (message: Notification) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(method: string, params: Record<string, unknown>, id?: string | number) {
    for (const listener of this.listeners)
      listener({ method, params, ...(id === undefined ? {} : { id }) });
  }
  replyToInput(id: string | number, answers: Record<string, { answers: string[] }>) {
    this.calls.push({ method: "replyToInput", params: { id, answers } });
    queueMicrotask(() =>
      this.emit("turn/completed", {
        threadId: "thread-1",
        turn: { id: "turn-thread-1", status: "completed" },
      }),
    );
  }
  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === "initialize") return { userAgent: "fixture" };
    if (method === "account/read")
      return { account: { type: "chatgpt" }, requiresOpenaiAuth: true };
    if (method === "model/list")
      return {
        data: [
          {
            model: "model-a",
            displayName: "Model A",
            hidden: false,
            supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
          },
          { model: "hidden", displayName: "Hidden", hidden: true },
        ],
      };
    if (method === "thread/start") return { thread: { id: `thread-${++this.nextThread}` } };
    if (method === "turn/interrupt") {
      if (this.interruptFailure) throw new Error(this.interruptFailure);
      return {};
    }
    if (method === "turn/start") {
      const threadId = String(params.threadId);
      const turnId = `turn-${threadId}`;
      if (this.requestInput) {
        queueMicrotask(() =>
          this.emit(
            "item/tool/requestUserInput",
            {
              threadId,
              turnId,
              itemId: "item-1",
              questions: [{ id: "choice", header: "Choice", question: "Choose", options: [] }],
              isBlocking: true,
              autoResolutionMs: null,
            },
            0,
          ),
        );
        return { turn: { id: turnId } };
      }
      queueMicrotask(() => {
        this.emit("item/agentMessage/delta", { threadId, turnId, delta: "progress" });
        this.emit("turn/completed", {
          threadId,
          turn: {
            id: turnId,
            status: this.failFirst && threadId === "thread-1" ? "failed" : "completed",
          },
        });
      });
      return { turn: { id: turnId } };
    }
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    if (method === "thread/read") {
      if (this.recoveryActive)
        queueMicrotask(() => {
          this.emit("item/agentMessage/delta", {
            threadId: "thread-1",
            turnId: "turn-thread-1",
            delta: "resumed",
          });
          this.emit("turn/completed", {
            threadId: "thread-1",
            turn: { id: "turn-thread-1", status: "completed" },
          });
        });
      return {
        thread: {
          id: params.threadId,
          turns: [
            {
              id: "turn-thread-1",
              status: this.recoveryActive ? "inProgress" : "completed",
              items: [{ type: "agentMessage", text: "saved" }],
            },
          ],
        },
      };
    }
    if (method === "turn/steer") return {};
    throw new Error(`Unexpected method ${method}`);
  }
}

export const input: StepExecutionInput = {
  runId: "run-1",
  stepId: "selected-step",
  attempt: 1,
  instruction: "Fixture only",
  projectDirectory: "/tmp/disposable-project",
  binding: { provider: "codex", model: "model-a" },
};

export async function collect(
  adapter: AgentAdapter,
  step: StepExecutionInput,
): Promise<AdapterEvent[]> {
  const result: AdapterEvent[] = [];
  for await (const event of adapter.execute(step, new AbortController().signal)) result.push(event);
  return result;
}
