import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { AgentConnection } from "./contract.js";
import { WINDOWS_LAUNCHABLE_EXTENSIONS } from "./launch.js";

const executableNames = [
  { provider: "codex", names: ["codex"] },
  { provider: "cursor", names: ["cursor-agent", "agent"] },
  { provider: "kiro", names: ["kiro-cli"] },
  { provider: "claude-code", names: ["claude"] },
] as const;

const findExecutable = async (
  names: readonly string[],
  searchPath: string,
  platform: NodeJS.Platform,
): Promise<string | null> => {
  for (const directory of searchPath.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      // Launchable Windows entries come before the extensionless npm shim, which passes
      // access() but cannot be started.
      const candidates =
        platform === "win32"
          ? [...WINDOWS_LAUNCHABLE_EXTENSIONS.map((extension) => `${name}${extension}`), name]
          : [name];
      for (const candidate of candidates) {
        const path = join(directory, candidate);
        try {
          await access(path, constants.X_OK);
          if (!(await stat(path)).isFile()) continue;
          return path;
        } catch {
          /* Try the next candidate. */
        }
      }
    }
  }
  return null;
};

/** Detect executable candidates without launching agents or reading credentials. */
export const discoverAgents = async (
  searchPath = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
): Promise<AgentConnection[]> => {
  const discovered: AgentConnection[] = await Promise.all(
    executableNames.map(async ({ provider, names }) => {
      const executable = await findExecutable(names, searchPath, platform);
      return {
        provider,
        executable,
        installation: executable ? "detected" : "missing",
        authentication: "unknown",
        capabilities: {
          streaming: "unknown",
          steering: "unknown",
          resume: "unknown",
          pause: "unknown",
          waitingInput: "unknown",
        },
      } satisfies AgentConnection;
    }),
  );
  return [
    ...discovered,
    {
      provider: "custom" as const,
      executable: null,
      installation: "missing" as const,
      authentication: "unknown" as const,
      capabilities: {
        streaming: "unknown" as const,
        steering: "unknown" as const,
        resume: "unknown" as const,
        pause: "unknown" as const,
        waitingInput: "unknown" as const,
      },
      reason: "Choose an executable and supported protocol, then verify the handshake.",
    },
  ];
};
