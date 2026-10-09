import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import {
  type RpcMessage,
  type RpcListener,
  parseCodexMessage,
  claimCodexInputRequest,
  dispatchCodexMessage,
  type CodexRpc,
} from "./codex-protocol.js";

/** A private stdio app-server process; credentials stay in Codex's own store. */
export class CodexStdioRpc implements CodexRpc {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly listeners = new Set<RpcListener>();
  private nextId = 1;

  constructor(
    executable: string,
    options: {
      approveFileChange?(request: RpcMessage): boolean;
      approveCommandExecution?(request: RpcMessage): boolean;
    } = {},
  ) {
    // Each thread names its own working directory; the server process starts from a neutral one.
    this.child = spawn(executable, ["app-server", "--listen", "stdio://"], {
      cwd: tmpdir(),
      stdio: "pipe",
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let message: RpcMessage;
      try {
        message = parseCodexMessage(line);
      } catch {
        return;
      }
      dispatchCodexMessage(message, {
        response: (response) => {
          if (typeof response.id !== "number") return;
          const pending = this.pending.get(response.id);
          this.pending.delete(response.id);
          if (response.error)
            pending?.reject(new Error(response.error.message ?? "Codex RPC error"));
          else pending?.resolve(response.result);
        },
        notification: (notification) => {
          for (const listener of this.listeners) listener(notification);
        },
        userInputRequest: (request) => claimCodexInputRequest(this.listeners, request),
        send: (reply) => this.child.stdin.write(`${JSON.stringify(reply)}\n`),
        ...(options.approveFileChange ? { approveFileChange: options.approveFileChange } : {}),
        ...(options.approveCommandExecution
          ? { approveCommandExecution: options.approveCommandExecution }
          : {}),
      });
    });
    const fail = (error: Error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      for (const listener of this.listeners)
        listener({ method: "transport/closed", params: { message: error.message } });
    };
    this.child.on("error", fail);
    this.child.on("exit", (code) =>
      fail(new Error(`Codex app-server exited (${code ?? "signal"})`)),
    );
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  replyToInput(id: string | number, answers: Record<string, { answers: string[] }>): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: { answers } })}\n`);
  }

  subscribe(listener: RpcListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.child.kill();
  }
}
