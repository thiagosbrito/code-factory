import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { records, workspaces } from "./common.mjs";
import { checkpointTool, checkpointContext, saveCheckpoint } from "./context.mjs";
import { budgetArguments } from "./budgets.mjs";
import { readRecord, workspaceIdentity } from "./workspace-identity.mjs";

import {
  directStateTransitionBlocked,
  isDirectReviewTransition,
  isDirectStateTransition,
  publishReview,
  reviewTool,
} from "./review.mjs";

const workspace = realpathSync(process.cwd());
if (!workspace.startsWith(`${realpathSync(workspaces)}/`))
  throw new Error("Codex must run inside a ticket worktree.");
const identity = workspaceIdentity(workspace);
if (existsSync(join(records, `${identity.identifier}.json`))) {
  const receipt = readRecord(identity);
  if (["review-ready", "review-pending"].includes(receipt.state)) {
    console.error(
      `Skipping Codex pickup: ${identity.identifier} has a ${receipt.state} review receipt.`,
    );
    process.exit(0);
  }
}
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(LINEAR_|GITHUB_TOKEN$|GH_TOKEN$)/.test(key)),
);
const model = process.env.SYMPHONY_CODEX_MODEL ?? "gpt-6-sol";
const child = spawn(
  process.env.SYMPHONY_CODEX_BIN ?? "codex",
  ["app-server", "-c", `model=${JSON.stringify(model)}`, ...budgetArguments(process.env)],
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
    if (message.method === "item/tool/call" && isDirectStateTransition(message.params)) {
      let blocked;
      try {
        blocked = await directStateTransitionBlocked(workspace);
      } catch (error) {
        blocked = true;
        console.error(`Could not verify tracker state: ${error.message}`);
      }
      if (blocked) {
        child.stdin.write(
          JSON.stringify({
            id: message.id,
            result: {
              success: false,
              contentItems: [
                {
                  type: "inputText",
                  text: "State transition blocked: review handoff is published or its state could not be verified.",
                },
              ],
            },
          }) + "\n",
        );
        return;
      }
    }
    if (message.method === "item/tool/call" && message.params?.tool === checkpointTool.name) {
      try {
        const result = saveCheckpoint(workspace, message.params.arguments);
        child.stdin.write(
          JSON.stringify({
            id: message.id,
            result: {
              success: true,
              contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
            },
          }) + "\n",
        );
      } catch (error) {
        child.stdin.write(
          JSON.stringify({
            id: message.id,
            result: { success: false, contentItems: [{ type: "inputText", text: error.message }] },
          }) + "\n",
        );
      }
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
let initialTurn = true;
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    if (message.method === "thread/start") {
      // Symphony v0.0.3 emits legacy specs; Codex rejects a list mixing both formats.
      const tools = (message.params.dynamicTools ?? []).map((tool) =>
        tool.type ? tool : { type: "function", ...tool },
      );
      message.params.dynamicTools = [...tools, reviewTool, checkpointTool];
    }
    if (message.method === "turn/start") {
      if (initialTurn) {
        initialTurn = false;
        const context = checkpointContext(workspace);
        if (context)
          message.params.input = [...(message.params.input ?? []), { type: "text", text: context }];
      }
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
