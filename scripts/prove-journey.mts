import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseLoop } from "../src/domain/loop.js";
import { initializeProject, projectRevision, saveProjectSetup } from "../src/runtime/project.js";
import { saveDraft, publishDraft, readRun } from "../src/runtime/storage.js";
import { startLocalServer } from "../src/runtime/server.js";
import { trustProject } from "../src/runtime/trust.js";

// Explicit invocation uses three small native Kiro tasks and preserves a compact receipt.
const settleDelayMs = process.argv.includes("--no-settle-delay") ? 0 : 250;
const root = await mkdtemp(join(tmpdir(), "factory-native-journey-"));
const receipt: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  provider: "kiro",
  model: "claude-haiku-4.5",
  tracker: "configured fixture (not a live Linear retrieval)",
};
let local: Awaited<ReturnType<typeof startLocalServer>> | undefined;
const request = async (path: string, body?: unknown) => {
  const response = await fetch(`${local?.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response;
};
const settled = async (id: string, afterRetry = false) => {
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const run = await readRun(root, id);
    if (
      run &&
      !["pending", "running"].includes(run.status) &&
      (!afterRetry ||
        (run.steps.find((step) => step.stepId === "check")?.attempts.length ?? 0) >= 2)
    ) {
      // Persisted terminal status precedes execution cleanup; retain that race as a separate review finding.
      await new Promise((resolveWait) => setTimeout(resolveWait, settleDelayMs));
      return run;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Native journey timed out");
};
try {
  execFileSync("git", ["init", "-q", root]);
  await writeFile(join(root, "baseline.txt"), "native proof\n");
  execFileSync("git", ["-C", root, "add", "baseline.txt"]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Proof",
    "-c",
    "user.email=proof@example.invalid",
    "commit",
    "-qm",
    "Baseline",
  ]);
  await initializeProject(root);
  // The disposable project is the proof's own; trust it so the local API will run its steps.
  await trustProject(root);
  local = await startLocalServer({
    projectDirectory: root,
    port: 0,
    tracker: {
      retrieve: async (id) => ({
        id,
        title: "Disposable native journey",
        summary: "Create native.txt containing journey-proof.",
        attachments: [],
      }),
    },
  });
  await request("/api/agents/connect", { provider: "kiro", launch: true });
  await saveProjectSetup(root, {
    name: "Native journey",
    revision: await projectRevision(root),
    defaultBinding: { provider: "kiro", model: "claude-haiku-4.5" },
  });
  const review = (id: string) => ({
    id,
    name: id,
    kind: "agent",
    role: "reviewer",
    stage: "review",
    groupId: "reviews",
    instruction:
      "Read native.txt and verify it contains journey-proof. Do not modify files. Reply exactly pass on a single line if correct, otherwise blocked. Use no network or other directories.",
  });
  await saveDraft(
    root,
    parseLoop({
      schemaVersion: 2,
      id: "native-journey",
      name: "Native journey",
      version: 1,
      status: "draft",
      steps: [
        {
          id: "build",
          name: "Build",
          kind: "agent",
          role: "builder",
          stage: "implementation",
          instruction:
            "Use fs_write to create native.txt containing journey-proof in this project. Do not use network or inspect other directories. Reply briefly.",
        },
        review("quality"),
        review("security"),
        {
          id: "check",
          name: "Controlled retry check",
          kind: "check",
          role: "validator",
          stage: "validation",
          instruction: `node -e 'const fs=require("fs");if(!fs.existsSync(".git/journey-first")){fs.writeFileSync(".git/journey-first","1");process.exit(1)}if(!fs.readFileSync("native.txt","utf8").includes("journey-proof"))process.exit(2)'`,
        },
      ],
      dependencies: [
        { from: "build", to: "quality" },
        { from: "build", to: "security" },
        { from: "quality", to: "check" },
        { from: "security", to: "check" },
      ],
      groups: [
        {
          id: "reviews",
          name: "Parallel reviews",
          kind: "parallel",
          stepIds: ["quality", "security"],
        },
      ],
      joins: [{ stepId: "check", mode: "all", from: ["quality", "security"] }],
      decisions: [],
      policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 2 },
    }),
  );
  await publishDraft(root, "native-journey");
  const id = crypto.randomUUID();
  await request("/api/runs", {
    requestId: id,
    project: "selected",
    loopId: "native-journey",
    loopVersion: 1,
    description: "Disposable native release proof",
    ticketId: "THI-19",
  });
  await request(`/api/runs/${id}/execute`, {});
  const failed = await settled(id);
  receipt.firstTerminalSteps = failed.steps;
  receipt.firstTerminalMessages = failed.evidence.filter(
    (item) => item.kind === "event" && ["completed", "error"].includes(item.title),
  );
  if (failed.status !== "failed")
    throw new Error(`Expected controlled failed check, got ${failed.status}`);
  const attemptId = failed.steps.find((step) => step.stepId === "check")?.attempts.at(-1)?.id;
  await request(`/api/runs/${id}/retry`, { stepId: "check", attemptId });
  const finished = await settled(id, true);
  receipt.finalSteps = finished.steps;
  const evidence = await request(`/api/runs/${id}/evidence`).then((response) => response.json());
  const accepted = await request(`/api/runs/${id}/evidence`, {}).then((response) =>
    response.json(),
  );
  const workspace = join(root, finished.snapshot.baseline.workspace ?? "");
  const original = await readFile(join(workspace, "native.txt"), "utf8");
  await writeFile(join(workspace, "native.txt"), `${original}\nchanged`);
  const stale = await request(`/api/runs/${id}/evidence`).then((response) => response.json());
  const rejection = await fetch(`${local.url}/api/runs/${id}/evidence`, { method: "POST" });
  receipt.runId = id;
  receipt.steps = finished.steps.map((step) => ({
    stepId: step.stepId,
    status: step.status,
    attempts: step.attempts.map(({ id: attempt, startedAt, endedAt }) => ({
      id: attempt,
      startedAt,
      endedAt,
    })),
  }));
  const reviewers = finished.steps
    .filter((step) => ["quality", "security"].includes(step.stepId))
    .map((step) => step.attempts[0]);
  receipt.parallelOverlap =
    reviewers.length === 2 &&
    reviewers.every((attempt) => attempt?.startedAt && attempt.endedAt) &&
    Math.max(...reviewers.map((attempt) => Date.parse(attempt?.startedAt ?? ""))) <
      Math.min(...reviewers.map((attempt) => Date.parse(attempt?.endedAt ?? "")));
  receipt.freshValidation = evidence.summary.validation === "passed";
  receipt.explicitAcceptance = accepted.summary.acceptance === "accepted";
  receipt.staleAcceptanceRejected =
    stale.summary.acceptance === "invalidated" && rejection.status === 409;
  receipt.selectedRetryOnly = finished.steps.every(
    (step) => step.attempts.length === (step.stepId === "check" ? 2 : 1),
  );
  receipt.passed =
    finished.status === "succeeded" &&
    receipt.parallelOverlap &&
    receipt.freshValidation &&
    receipt.explicitAcceptance &&
    receipt.staleAcceptanceRejected &&
    receipt.selectedRetryOnly;
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  receipt.passed = false;
} finally {
  if (local) {
    local.server.closeAllConnections();
    await new Promise<void>((resolveClosed) => local?.server.close(() => resolveClosed()));
  }
  receipt.endedAt = new Date().toISOString();
  receipt.settleDelayMs = settleDelayMs;
  receipt.version = execFileSync("kiro-cli", ["--version"], { encoding: "utf8" }).trim();
  await writeFile(
    resolve("docs/evidence/thi19-native-journey-proof-2026-10-06.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(receipt));
  if (!receipt.passed) process.exitCode = 1;
}
