import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createClaudeCodeAdapter } from "../adapters/claude-code.js";
import { createCodexAdapter } from "../adapters/codex.js";
import { createKiroAdapter } from "../adapters/kiro.js";
import type { AgentAdapter, AgentConnection } from "../adapters/contract.js";
import { mockAdapter } from "../adapters/mock.js";
import { discoverAgents } from "../adapters/discovery.js";
import type { ConnectionMemory } from "./connection-memory.js";
import { connectionRequestSchema, type ConnectionRequest } from "./connection-request.js";
import { ProjectError } from "./project.js";

export { connectionRequestSchema, type ConnectionRequest };
/** Providers with an execution adapter that Code Factory launches from their detected CLI. */
export const NATIVE_PROVIDERS = ["codex", "kiro", "claude-code"] as const;
type NativeProvider = (typeof NATIVE_PROVIDERS)[number];
const isNativeProvider = (provider: string): provider is NativeProvider =>
  (NATIVE_PROVIDERS as readonly string[]).includes(provider);
type InspectableAdapter = {
  inspect(projectDirectory: string): Promise<AgentConnection>;
  close(): void;
  execute?: AgentAdapter["execute"];
  attach?: AgentAdapter["attach"];
  steer?: AgentAdapter["steer"];
  provider?: AgentAdapter["provider"];
  capabilities?: AgentAdapter["capabilities"];
};

/**
 * Decides whether an executable may be launched before anything starts it; throws to refuse. The
 * runtime uses it to keep executables that come from an untrusted project from running.
 */
export type LaunchAuthorizer = (
  provider: ConnectionRequest["provider"],
  executable: string,
) => Promise<void>;

const resolveExecutable = async (
  request: ConnectionRequest,
  candidates: AgentConnection[],
  authorize: LaunchAuthorizer,
): Promise<string> => {
  if (request.provider !== "custom") {
    const executable = candidates.find((item) => item.provider === request.provider)?.executable;
    if (!executable)
      throw new ProjectError(
        `${request.provider} executable is not detected. Install it and recheck.`,
        422,
      );
    await authorize(request.provider, executable);
    return executable;
  }

  if (!isAbsolute(request.executable))
    throw new ProjectError("Enter an absolute executable path.", 400);
  await authorize(request.provider, request.executable);
  try {
    const executable = await realpath(request.executable);
    await access(executable, constants.X_OK);
    if (!(await stat(executable)).isFile()) throw new Error("not a regular file");
    return executable;
  } catch {
    throw new ProjectError("Custom executable must be an accessible executable file.", 400);
  }
};

/** How long a listing waits for restored connections before showing what is connected so far. */
const RESTORE_WAIT_MS = 20_000;

/** Discovery is read-only. Only an explicit connect request may launch a provider process. */
export class ConnectionRegistry {
  private readonly active = new Map<
    string,
    { adapter: InspectableAdapter; connection: AgentConnection }
  >();

  constructor(
    private readonly projectDirectory: string,
    private readonly discover: () => Promise<AgentConnection[]> = () => discoverAgents(),
    private readonly createCodex: (
      executable: string,
    ) => Promise<InspectableAdapter> = createCodexAdapter,
    private readonly createKiro: (
      executable: string,
    ) => Promise<InspectableAdapter> = createKiroAdapter,
    private readonly createClaudeCode: (
      executable: string,
    ) => Promise<InspectableAdapter> = createClaudeCodeAdapter,
    private readonly memory?: ConnectionMemory,
  ) {}

  /** Connections being restored after a start; the first listing waits for them, briefly. */
  private restoring: Promise<unknown> | undefined;

  /**
   * Connects again every agent the user connected for this project before. Each goes through the
   * same launch authorization as a click on Verify; one that fails (uninstalled, signed out,
   * project not yet trusted) stays disconnected and the others are unaffected.
   */
  restore(authorize: LaunchAuthorizer): Promise<void> {
    const memory = this.memory;
    if (!memory) return Promise.resolve();
    const restoring = (async () => {
      const requests = await memory.read().catch((error: unknown) => {
        console.warn(`Code Factory could not restore agent connections: ${String(error)}`);
        return [];
      });
      await Promise.allSettled(requests.map((request) => this.connect(request, authorize)));
    })().finally(() => {
      if (this.restoring === restoring) this.restoring = undefined;
    });
    this.restoring = restoring;
    return restoring;
  }

  private create(provider: ConnectionRequest["provider"], executable: string) {
    if (provider === "kiro") return this.createKiro(executable);
    if (provider === "claude-code") return this.createClaudeCode(executable);
    // A custom executable speaks the Codex app-server protocol.
    return this.createCodex(executable);
  }

  async list(): Promise<AgentConnection[]> {
    if (this.restoring) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        this.restoring,
        new Promise((resolve) => {
          timer = setTimeout(resolve, RESTORE_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
      // Only the first listing waits; a restore that is still stuck never slows the next ones.
      this.restoring = undefined;
    }
    const candidates = await this.discover();
    return candidates.map((candidate) => {
      const active = this.active.get(candidate.provider)?.connection;
      if (active && (candidate.provider === "custom" || active.executable === candidate.executable))
        return active;
      if (!isNativeProvider(candidate.provider) && candidate.provider !== "custom")
        return {
          ...candidate,
          reason:
            candidate.installation === "missing"
              ? "Executable not detected. This provider adapter is not implemented."
              : "Executable detected; connection adapter is not implemented.",
        };
      return candidate;
    });
  }

  adapter(provider: string): AgentAdapter | null {
    if (provider === "mock") return mockAdapter;
    const active = this.active.get(provider);
    const adapter = active?.adapter;
    if (
      !adapter?.execute ||
      !adapter.attach ||
      !adapter.steer ||
      !adapter.provider ||
      !adapter.capabilities
    )
      return null;
    return {
      ...adapter,
      provider: adapter.provider,
      capabilities: adapter.capabilities,
      inspect: adapter.inspect.bind(adapter),
      execute: adapter.execute.bind(adapter),
      attach: adapter.attach.bind(adapter),
      steer: adapter.steer.bind(adapter),
    };
  }

  /** Counts connect requests per provider, so a slow older one cannot replace a newer one. */
  private readonly latestConnect = new Map<string, number>();

  async connect(
    request: ConnectionRequest,
    authorize: LaunchAuthorizer = async () => undefined,
  ): Promise<AgentConnection> {
    const ticket = (this.latestConnect.get(request.provider) ?? 0) + 1;
    this.latestConnect.set(request.provider, ticket);
    const candidates = await this.discover();
    const executable = await resolveExecutable(request, candidates, authorize);
    let adapter: InspectableAdapter | undefined;
    try {
      adapter = await this.create(request.provider, executable);
      const inspected = await adapter.inspect(this.projectDirectory);
      if (
        inspected.provider !== (request.provider === "custom" ? "codex" : request.provider) ||
        !inspected.version ||
        !inspected.protocol
      )
        throw new Error("Identity or protocol handshake did not verify the selected CLI.");
      const connection: AgentConnection =
        request.provider === "custom"
          ? {
              ...inspected,
              provider: "custom",
              protocol: request.protocol,
              identity: inspected.identity ?? "Codex CLI",
            }
          : inspected;
      if (this.latestConnect.get(request.provider) !== ticket)
        throw new Error("A newer connection request for this agent replaced this one.");
      this.active.get(request.provider)?.adapter.close();
      this.active.set(request.provider, { adapter, connection });
      // Remembering is a convenience: a connection that works is not undone by a failed write.
      await this.memory?.remember(request).catch((error: unknown) => {
        console.warn(`Code Factory could not remember this connection: ${String(error)}`);
      });
      return connection;
    } catch (error) {
      adapter?.close();
      throw new ProjectError(
        `Connection verification failed: ${error instanceof Error ? error.message : "unknown error"}`,
        422,
      );
    }
  }

  close(): void {
    for (const entry of this.active.values()) entry.adapter.close();
    this.active.clear();
  }
}
