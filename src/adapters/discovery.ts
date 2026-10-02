import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { AgentConnection } from "./contract.js";

const executableNames = [
  { provider: "codex", names: ["codex"] },
  { provider: "cursor", names: ["cursor-agent", "agent"] },
  { provider: "kiro", names: ["kiro-cli"] },
  { provider: "claude-code", names: ["claude"] },
] as const;

async function findExecutable(
  names: readonly string[],
  searchPath: string,
): Promise<string | null> {
  for (const directory of searchPath.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidates =
        process.platform === "win32" ? [name, `${name}.exe`, `${name}.cmd`] : [name];
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
}

/** Detect executable candidates without launching agents or reading credentials. */
export async function discoverAgents(
  searchPath = process.env.PATH ?? "",
): Promise<AgentConnection[]> {
  return Promise.all(
    executableNames.map(async ({ provider, names }) => {
      const executable = await findExecutable(names, searchPath);
      return {
        provider,
        executable,
        installation: executable ? "detected" : "missing",
        authentication: "unknown",
        capabilities: { streaming: "unknown", steering: "unknown", resume: "unknown" },
      };
    }),
  );
}
