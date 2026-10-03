import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { workspaces } from "./common.mjs";

import { isDirectReviewTransition, publishReview, reviewTool } from "./review.mjs";

const workspace = realpathSync(process.cwd());
if (!workspace.startsWith(`${realpathSync(workspaces)}/`))
  throw new Error("Codex must run inside a ticket worktree.");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(LINEAR_|GITHUB_TOKEN$|GH_TOKEN$)/.test(key)),
);
const model = process.env.SYMPHONY_CODEX_MODEL ?? "gpt-6-sol";
const child = spawn(
  process.env.SYMPHONY_CODEX_BIN ?? "codex",
  ["app-server", "-c", `model=${JSON.stringify(model)}`],
  {
    cwd: workspace,
    env: environment,
    stdio: ["pipe", "pipe", "inherit"],
  },
);

const output = createInterface({ input: child.stdout });
output.on("line", async (line) => {
  try {
    const message = JSON.parse(line);
    if (message.method === "item/tool/call" && isDirectReviewTransition(message.params)) {
      child.stdin.write(
        JSON.stringify({
          id: message.id,
          result: {
            success: false,
            contentItems: [
              {
                type: "inputText",
                text: "In Review requires a verified PR. Use symphony_publish_review for this transition.",
              },
            ],
          },
        }) + "\n",
      );
      return;
    }
    if (message.method === "item/tool/call" && message.params?.tool === reviewTool.name) {
      try {
        const result = await publishReview(workspace, message.params.arguments);
        child.stdin.write(
          JSON.stringify({
            id: message.id,
            result: {
              success: result.success,
              contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
            },
          }) + "\n",
        );
      } catch (error) {
        child.stdin.write(
          JSON.stringify({
            id: message.id,
            result: {
              success: false,
              contentItems: [{ type: "inputText", text: error.message }],
            },
          }) + "\n",
        );
      }
      return;
    }
    // Symphony v0.0.3 expects separate failure events; current Codex uses turn/completed.
    if (message.method === "turn/completed") {
      const status = message.params?.turn?.status;
      if (status === "failed") message.method = "turn/failed";
      else if (status === "interrupted") message.method = "turn/cancelled";
    }
    process.stdout.write(JSON.stringify(message) + "\n");
  } catch {
    process.stdout.write(line + "\n");
  }
});
child.stdin.on("error", () => {
  input.close();
});
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    if (message.method === "thread/start") {
      // Symphony v0.0.3 emits legacy specs; Codex rejects a list mixing both formats.
      const tools = (message.params.dynamicTools ?? []).map((tool) =>
        tool.type ? tool : { type: "function", ...tool },
      );
      message.params.dynamicTools = [...tools, reviewTool];
    }
    if (message.method === "turn/start") {
      message.params.sandboxPolicy = {
        type: "workspaceWrite",
        writableRoots: [workspace],
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
