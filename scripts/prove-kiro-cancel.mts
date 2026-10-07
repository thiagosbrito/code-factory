import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKiroAdapter } from "../src/adapters/kiro.js";
const marker = "CANCEL_THI19_20261006";
const project = await mkdtemp(join(tmpdir(), "thi19-native-cancel-"));
const adapter = await createKiroAdapter("/Users/thiagosbrito/.local/bin/kiro-cli");
const iterator = adapter
  .execute(
    {
      runId: "native-cancel",
      stepId: "cancel",
      attempt: 1,
      projectDirectory: project,
      binding: { provider: "kiro", model: "claude-haiku-4.5" },
      instruction: `Native cancellation proof ${marker}. Reply briefly.`,
    },
    AbortSignal.timeout(45000),
  )
  [Symbol.asyncIterator]();
const first = await iterator.next();
const matching = () =>
  execFileSync("ps", ["-axo", "pid,command"], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes(marker) && line.includes("kiro-cli"))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
const before = matching();
adapter.close();
let stopped = false;
try {
  while (!(await iterator.next()).done) {}
} catch {
  stopped = true;
}
await new Promise((resolve) => setTimeout(resolve, 500));
const after = matching();
const receipt = {
  version: execFileSync("kiro-cli", ["--version"], { encoding: "utf8" }).trim(),
  firstEvent: first.value?.type,
  before,
  after,
  stopped,
  capabilities: adapter.capabilities,
  passed: stopped && after.length === 0,
};
await writeFile(
  "docs/evidence/thi19-combined-kiro-cancel-proof-2026-10-06.json",
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt));
if (after.length)
  for (const pid of after)
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
if (!receipt.passed) process.exitCode = 1;
