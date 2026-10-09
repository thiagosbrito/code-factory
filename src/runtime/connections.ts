import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { createClaudeCodeAdapter } from "../adapters/claude-code.js";
import { createCodexAdapter } from "../adapters/codex.js";
import { createKiroAdapter } from "../adapters/kiro.js";
import type { AgentAdapter, AgentConnection } from "../adapters/contract.js";
import { mockAdapter } from "../adapters/mock.js";
import { discoverAgents } from "../adapters/discovery.js";
import { ProjectError } from "./project.js";

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

const resolveExecutable = async (
  request: ConnectionRequest,
  candidates: AgentConnection[],
): Promise<string> => {
  if (request.provider !== "custom") {
    const executable = candidates.find((item) => item.provider === request.provider)?.executable;
    if (!executable)
      throw new ProjectError(
        `${request.provider} executable is not detected. Install it and recheck.`,
        422,
      );
    return executable;
  }

  if (!isAbsolute(request.executable))
    throw new ProjectError("Enter an absolute executable path.", 400);
  try {
    const executable = await realpath(request.executable);
    await access(executable, constants.X_OK);
    if (!(await stat(executable)).isFile()) throw new Error("not a regular file");
    return executable;
  } catch {
    throw new ProjectError("Custom executable must be an accessible executable file.", 400);
  }
};

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
  ) {}

  private create(provider: ConnectionRequest["provider"], executable: string) {
    if (provider === "kiro") return this.createKiro(executable);
    if (provider === "claude-code") return this.createClaudeCode(executable);
    // A custom executable speaks the Codex app-server protocol.
    return this.createCodex(executable);
  }

  async list(): Promise<AgentConnection[]> {
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

  async connect(request: ConnectionRequest): Promise<AgentConnection> {
    const candidates = await this.discover();
    const executable = await resolveExecutable(request, candidates);
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
      this.active.get(request.provider)?.adapter.close();
      this.active.set(request.provider, { adapter, connection });
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
