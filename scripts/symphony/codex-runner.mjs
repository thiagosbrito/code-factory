import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { repository, workspaces } from "./common.mjs";

const workspace = realpathSync(process.cwd());
if (!workspace.startsWith(`${realpathSync(workspaces)}/`))
  throw new Error("Codex must run inside a ticket worktree.");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(LINEAR_|GITHUB_TOKEN$|GH_TOKEN$)/.test(key)),
);
const child = spawn(process.env.SYMPHONY_CODEX_BIN ?? "codex", ["app-server"], {
  cwd: workspace,
  env: environment,
  stdio: ["pipe", "pipe", "inherit"],
});

child.stdout.pipe(process.stdout);
child.stdin.on("error", () => {
  input.close();
});
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    if (message.method === "turn/start") {
      message.params.sandboxPolicy = {
        type: "workspaceWrite",
        writableRoots: [workspace, realpathSync(repository)],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
    }
    child.stdin.write(JSON.stringify(message) + "\n");
  } catch {
    console.error("Invalid app-server input.");
    child.kill("SIGTERM");
    process.exitCode = 1;
  }
});
input.on("close", () => child.stdin.end());
child.on("error", () => {
  console.error("Could not launch Codex app-server.");
  process.exitCode = 1;
  input.close();
});
child.on("exit", (code, signal) => {
  input.close();
  process.exitCode = process.exitCode ?? (signal ? 1 : (code ?? 1));
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
