import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { AgentConnection } from "./contract.js";
import { PROBE_OUTPUT_LIMIT, parseJson, stripAnsi, terminateChild } from "./process.js";

const CATALOG_TIMEOUT_MS = 30_000;
const REQUEST_ID = "code-factory-models";

const catalogResponse = z.object({
  type: z.literal("control_response"),
  response: z.object({
    subtype: z.string(),
    request_id: z.string().optional(),
    error: z.string().optional(),
    response: z
      .object({
        models: z.array(
          z.object({
            value: z.string().min(1),
            displayName: z.string().min(1),
            description: z.string().optional(),
            supportedEffortLevels: z.array(z.string()).optional(),
          }),
        ),
      })
      .optional(),
  }),
});

type CatalogModel = NonNullable<AgentConnection["models"]>[number];

/**
 * Asks the CLI itself which models this login can use: the stream-json `initialize` request that
 * the Agent SDK's `supportedModels()` is built on. Only the model list is read from the reply; the
 * account, commands and settings it also carries are ignored. The CLI's `default` entry is the
 * agent default Code Factory already offers, so it is left out.
 */
export const listClaudeCodeModels = (executable: string): Promise<CatalogModel[]> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
      ],
      {
        // A neutral directory, so no project's configuration shapes the catalog.
        cwd: tmpdir(),
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1" },
        detached: process.platform !== "win32",
      },
    );
    let settled = false;
    let stderr = "";
    const finish = (outcome: { models: CatalogModel[] } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.destroy();
      terminateChild(child);
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.models);
    };
    const timer = setTimeout(
      () => finish({ error: new Error("claude did not list its models within 30 s") }),
      CATALOG_TIMEOUT_MS,
    );
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-PROBE_OUTPUT_LIMIT);
    });
    child.once("error", (error) => finish({ error }));
    // The CLI may exit before it reads the request; that surfaces through "close", not a crash.
    child.stdin.on("error", () => undefined);
    child.once("close", (code) =>
      finish({
        error: new Error(
          `claude exited with code ${code} before listing its models: ${stripAnsi(stderr.trim()) || "no output"}`,
        ),
      }),
    );
    createInterface({ input: child.stdout }).on("line", (line) => {
      const parsed = catalogResponse.safeParse(parseJson(line));
      if (!parsed.success || parsed.data.response.request_id !== REQUEST_ID) return;
      const { subtype, error, response } = parsed.data.response;
      if (subtype !== "success" || !response)
        return finish({
          error: new Error(`claude refused to list its models: ${error ?? subtype}`),
        });
      finish({
        models: response.models
          .filter((model) => model.value !== "default")
          .map((model) => ({
            id: model.value,
            displayName: model.displayName,
            ...(model.description ? { description: model.description } : {}),
            efforts: model.supportedEffortLevels ?? [],
          })),
      });
    });
    child.stdin.write(
      `${JSON.stringify({ type: "control_request", request_id: REQUEST_ID, request: { subtype: "initialize" } })}\n`,
    );
  });
