import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import { captureGitBaseline } from "../src/runtime/baseline.js";
import { inspectArtifact, inspectDiff, inspectFiles } from "../src/runtime/inspection.js";
import { startLocalServer } from "../src/runtime/server.js";
import { createRun } from "../src/runtime/storage.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "factory-inspection-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", root]);
  await writeFile(join(root, "existing.txt"), "original\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "Initial",
  ]);
  await writeFile(join(root, "existing.txt"), "pre-existing\n");
  const baseline = await captureGitBaseline(root);
  const workspace = join(root, baseline.workspace!);
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps: [{ id: "build", name: "Build", kind: "agent", role: "builder", instruction: "Build" }],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 2 },
  });
  const run = createRunRecord(
    createRunSnapshot(
      loop,
      { description: "Task" },
      { provider: "mock", model: "default" },
      baseline,
    ),
  );
  return { root, workspace, run };
};

it("separates captured pre-existing changes from task changes and reports uncertain attribution", async () => {
  const { root, workspace, run } = await fixture();
  await writeFile(join(workspace, "existing.txt"), "task edit\n");
  await writeFile(join(workspace, "new.txt"), "new\n");
  const result = await inspectFiles(root, run);
  expect(result.preExisting).toMatchObject([{ path: "existing.txt", change: "modified" }]);
  expect(result.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "existing.txt", attribution: "uncertain" }),
      expect.objectContaining({ path: "new.txt", change: "added" }),
    ]),
  );
  expect((await inspectDiff(root, run, "existing.txt")).diff).toContain("+task edit");
  await expect(inspectDiff(root, run, "../existing.txt")).rejects.toThrow("not a task change");
});

it("reads only declared owned artifact bytes and detects missing, changed and linked outputs", async () => {
  const { root, workspace, run } = await fixture();
  await mkdir(join(workspace, "reports"));
  const bytes = Buffer.from("# Report\n<script>alert(1)</script>\n");
  await writeFile(join(workspace, "reports", "report.md"), bytes);
  const receipt = {
    kind: "artifact" as const,
    id: crypto.randomUUID(),
    runId: run.snapshot.id,
    stepId: "build",
    attemptId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    name: "report.md",
    mediaType: "text/markdown",
    relativePath: "reports/report.md",
    digest: createHash("sha256").update(bytes).digest("hex"),
    provenance: {
      source: "agent" as const,
      baselineId: run.snapshot.baseline.id,
      candidateId: "candidate",
      inputReceiptIds: [],
    },
    freshness: { state: "current" as const, checkedAgainstCandidateId: "candidate" },
  };
  const withReceipt = { ...run, evidence: [receipt] };
  expect(await inspectArtifact(root, withReceipt, receipt.id)).toMatchObject({
    name: "report.md",
    mediaType: "text/markdown",
    base64: bytes.toString("base64"),
  });
  await expect(inspectArtifact(root, withReceipt, crypto.randomUUID())).rejects.toThrow(
    "not found",
  );
  await writeFile(join(workspace, "reports", "report.md"), "changed");
  await expect(inspectArtifact(root, withReceipt, receipt.id)).rejects.toThrow("changed");
  await rm(join(workspace, "reports", "report.md"));
  await symlink(join(root, "existing.txt"), join(workspace, "reports", "report.md"));
  await expect(inspectArtifact(root, withReceipt, receipt.id)).rejects.toThrow("Linked outputs");
  await expect(
    inspectArtifact(
      root,
      { ...run, evidence: [{ ...receipt, relativePath: "../existing.txt" }] },
      receipt.id,
    ),
  ).rejects.toThrow("Invalid project-relative path");
  await rm(join(workspace, "reports", "report.md"));
  await writeFile(join(workspace, "reports", "report.md"), bytes);
  await expect(
    inspectArtifact(
      root,
      { ...run, evidence: [{ ...receipt, mediaType: "image/png" }] },
      receipt.id,
    ),
  ).rejects.toThrow("does not match");
});

it("serves read-only inspection for a persisted run and rejects unsafe or missing selections", async () => {
  const { root, workspace, run } = await fixture();
  await createRun(root, run);
  await writeFile(join(workspace, "task.txt"), "task\n");
  const { server, url } = await startLocalServer({ projectDirectory: root, port: 0 });
  try {
    const base = `${url}/api/runs/${run.snapshot.id}/inspection`;
    const files = await fetch(base);
    expect(files.status).toBe(200);
    expect((await files.json()).files).toEqual([expect.objectContaining({ path: "task.txt" })]);
    expect((await fetch(`${base}/diff?path=task.txt`)).status).toBe(200);
    expect((await fetch(`${base}/diff?path=..%2Ftask.txt`)).status).toBe(404);
    expect((await fetch(`${base}/artifact?id=unknown`)).status).toBe(404);
    expect((await fetch(base, { method: "POST" })).status).toBe(405);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
