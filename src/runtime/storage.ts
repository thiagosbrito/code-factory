import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { ZodError } from "zod";
import { parseLoop, type LoopDefinition } from "../domain/loop.js";
import {
  createRunRecord,
  createRunSnapshot,
  runRecordSchema,
  type Baseline,
  type RunRecord,
} from "../domain/run.js";
import type { ExecutionBinding } from "../domain/loop.js";

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
async function factoryRoot(projectDirectory: string): Promise<string> {
  const project = await realpath(projectDirectory);
  const root = join(project, ".code-factory");
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink())
    throw new Error(".code-factory must be a real directory.");
  return root;
}
function explain(path: string, error: unknown): Error {
  if (error instanceof ZodError)
    return new Error(
      `Invalid ${path}: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      { cause: error },
    );
  if (error instanceof SyntaxError)
    return new Error(`Invalid JSON in ${path}: ${error.message}`, { cause: error });
  return error instanceof Error ? error : new Error(String(error));
}
async function readJson(path: string): Promise<unknown | undefined> {
  try {
    await rejectLinkedFile(path);
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (missing(error)) return undefined;
    throw explain(path, error);
  }
}
async function rejectLinkedFile(path: string): Promise<void> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isFile())
      throw new Error(`Storage path must be a real file: ${path}`);
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
}
async function atomicWrite(path: string, value: unknown): Promise<void> {
  await rejectLinkedFile(path);
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  try {
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
async function exclusiveWrite(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  try {
    await link(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
function loopId(id: string): string {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error(`Invalid loop ID: ${id}`);
  return id;
}
async function rejectLinkedDirectory(path: string): Promise<void> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error(`Storage path must be a real directory: ${path}`);
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
}
async function loopDirectory(project: string, id: string): Promise<string> {
  const loops = join(await factoryRoot(project), "loops");
  const directory = join(loops, loopId(id));
  await rejectLinkedDirectory(loops);
  await rejectLinkedDirectory(directory);
  return directory;
}
async function runDirectory(project: string): Promise<string> {
  const directory = join(await factoryRoot(project), "runs");
  await rejectLinkedDirectory(directory);
  return directory;
}
export async function listPublishedVersions(project: string, id: string): Promise<number[]> {
  const directory = join(await loopDirectory(project, id), "versions");
  await rejectLinkedDirectory(directory);
  try {
    return (await readdir(directory))
      .filter((name) => /^[1-9][0-9]*\.json$/.test(name))
      .map((name) => Number(name.slice(0, -5)))
      .sort((a, b) => a - b);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}
export async function readDraft(project: string, id: string): Promise<LoopDefinition | null> {
  const path = join(await loopDirectory(project, id), "draft.json");
  const raw = await readJson(path);
  if (raw === undefined) return null;
  try {
    const loop = parseLoop(raw);
    if (loop.id !== id || loop.status !== "draft")
      throw new Error(`Draft file identity mismatch: ${path}`);
    return loop;
  } catch (error) {
    throw explain(path, error);
  }
}
export async function readPublishedVersion(
  project: string,
  id: string,
  version: number,
): Promise<LoopDefinition | null> {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Invalid loop version.");
  const directory = join(await loopDirectory(project, id), "versions");
  await rejectLinkedDirectory(directory);
  const path = join(directory, `${version}.json`);
  const raw = await readJson(path);
  if (raw === undefined) return null;
  try {
    const loop = parseLoop(raw);
    if (loop.id !== id || loop.version !== version || loop.status !== "published")
      throw new Error(`Published file identity mismatch: ${path}`);
    return loop;
  } catch (error) {
    throw explain(path, error);
  }
}
/** Import validation finishes before a file is replaced. Published versions are never draft targets. */
export async function saveDraft(project: string, input: unknown): Promise<LoopDefinition> {
  const loop = parseLoop(input);
  if (loop.status !== "draft") throw new Error("Only a draft can be saved as a draft.");
  const directory = await loopDirectory(project, loop.id);
  // A damaged or mismatched saved draft needs an explicit repair, never a silent replacement.
  await readDraft(project, loop.id);
  const versions = await listPublishedVersions(project, loop.id);
  const next = (versions.at(-1) ?? 0) + 1;
  if (loop.version !== next)
    throw new Error(`Draft ${loop.id} must target future version ${next}.`);
  await mkdir(directory, { recursive: true });
  await rejectLinkedDirectory(directory);
  await atomicWrite(join(directory, "draft.json"), loop);
  return loop;
}
export async function publishDraft(project: string, id: string): Promise<LoopDefinition> {
  const draft = await readDraft(project, id);
  if (!draft) throw new Error(`No saved draft for ${id}.`);
  const versions = await listPublishedVersions(project, id);
  if (draft.version !== (versions.at(-1) ?? 0) + 1)
    throw new Error(`Draft ${id} is stale; reload the next version.`);
  const published = parseLoop({ ...draft, status: "published" });
  const directory = join(await loopDirectory(project, id), "versions");
  await mkdir(directory, { recursive: true });
  await rejectLinkedDirectory(directory);
  await exclusiveWrite(join(directory, `${published.version}.json`), published);
  await atomicWrite(join(await loopDirectory(project, id), "draft.json"), {
    ...draft,
    version: draft.version + 1,
  });
  return published;
}
export async function readRun(project: string, id: string): Promise<RunRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid run ID.");
  const path = join(await runDirectory(project), `${id}.json`);
  const raw = await readJson(path);
  if (raw === undefined) return null;
  try {
    const record = runRecordSchema.parse(raw);
    if (record.snapshot.id !== id) throw new Error(`Run file identity mismatch: ${path}`);
    return record;
  } catch (error) {
    throw explain(path, error);
  }
}
export async function createRun(project: string, input: RunRecord): Promise<RunRecord> {
  const record = runRecordSchema.parse(input);
  if (record.revision !== 0) throw new Error("A new run must start at revision zero.");
  const directory = await runDirectory(project);
  await mkdir(directory, { recursive: true });
  await rejectLinkedDirectory(directory);
  await exclusiveWrite(join(directory, `${record.snapshot.id}.json`), record);
  return record;
}
export async function createRunFromPublished(
  project: string,
  loopId: string,
  version: number,
  task: unknown,
  defaultBinding: ExecutionBinding,
  baseline: Baseline,
): Promise<RunRecord> {
  const loop = await readPublishedVersion(project, loopId, version);
  if (!loop) throw new Error(`Published loop ${loopId} v${version} does not exist.`);
  return createRun(
    project,
    createRunRecord(createRunSnapshot(loop, task, defaultBinding, baseline)),
  );
}
/** Serialized updates preserve immutable inputs and reject stale, destructive history writes. */
export async function updateRun(project: string, input: RunRecord): Promise<RunRecord> {
  const record = runRecordSchema.parse(input);
  const directory = await runDirectory(project);
  const path = join(directory, `${record.snapshot.id}.json`);
  const lock = `${path}.lock`;
  await mkdir(lock);
  try {
    const current = await readRun(project, record.snapshot.id);
    if (!current) throw new Error("Run does not exist.");
    if (record.revision !== current.revision + 1)
      throw new Error("Run revision conflict; reload before updating.");
    if (JSON.stringify(record.snapshot) !== JSON.stringify(current.snapshot))
      throw new Error("Run snapshot is immutable.");
    if (
      current.rounds.some(
        (round, index) => JSON.stringify(record.rounds[index]) !== JSON.stringify(round),
      )
    )
      throw new Error("Implementation round history is immutable.");
    for (const oldStep of current.steps) {
      const next = record.steps.find((step) => step.stepId === oldStep.stepId);
      if (
        next?.id !== oldStep.id ||
        oldStep.attempts.some((attempt, index) => {
          const updated = next.attempts[index];
          if (!updated || updated.id !== attempt.id) return true;
          if (attempt.status === "running") {
            const {
              status: _oldStatus,
              endedAt: _oldEnded,
              sessionId: _oldSession,
              turnId: _oldTurn,
              ...oldIdentity
            } = attempt;
            const {
              status: _newStatus,
              endedAt: _newEnded,
              sessionId: _newSession,
              turnId: _newTurn,
              ...newIdentity
            } = updated;
            return (
              JSON.stringify(oldIdentity) !== JSON.stringify(newIdentity) ||
              (Boolean(attempt.sessionId) && attempt.sessionId !== updated.sessionId) ||
              (Boolean(attempt.turnId) && attempt.turnId !== updated.turnId) ||
              !["running", "succeeded", "failed", "canceled"].includes(updated.status)
            );
          }
          return JSON.stringify(updated) !== JSON.stringify(attempt);
        })
      )
        throw new Error("Step and attempt identities/history are immutable.");
    }
    if (
      current.evidence.some(
        (receipt, index) => JSON.stringify(record.evidence[index]) !== JSON.stringify(receipt),
      )
    )
      throw new Error("Evidence history is append-only.");
    await atomicWrite(path, record);
    return record;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
