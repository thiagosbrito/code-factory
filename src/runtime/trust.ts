import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { TOOL_GRANT_SCOPE, type GrantableProvider, type ToolGrants } from "../domain/tool-grant.js";
import { trustFileSchema, type ProjectTrustEntry, type TrustFile } from "../domain/trust.js";
import { createKeyedLock } from "./keyed-lock.js";
import { canonicalPath, isWithin } from "./launch-safety.js";
import { ProjectError } from "./project.js";

/** An environment folder counts only when absolute, as the XDG specification requires. */
const absoluteEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value && isAbsolute(value) ? value : undefined;
};

/**
 * The user-level directory for trust decisions: `CODE_FACTORY_HOME`, else the platform's user
 * configuration folder. It is read on every call, so tests and tools can point it elsewhere.
 */
export const trustDirectory = (): string => {
  const home = absoluteEnv("CODE_FACTORY_HOME");
  if (home) return home;
  const appData = absoluteEnv("APPDATA");
  if (process.platform === "win32" && appData) return join(appData, "code-factory");
  return join(absoluteEnv("XDG_CONFIG_HOME") ?? join(homedir(), ".config"), "code-factory");
};
const trustPath = () => join(trustDirectory(), "trust.json");
const withTrustFile = createKeyedLock();

/** Another process's lock older than this was left by a crash and is taken over. */
const STALE_LOCK_MS = 10_000;
/** Longer than the stale age, so a waiter always outlives a crashed holder's lock. */
const LOCK_WAIT_MS = 15_000;

const isCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

/**
 * Cross-process exclusion for read-modify-write of the trust file: two Code Factory runtimes (one
 * per project) share it, and the in-process lock cannot see the other one. The lock is a file
 * created exclusively; it holds a token so a holder never removes a lock another process took over.
 */
const withTrustFileLock = async <T>(work: () => Promise<T>): Promise<T> => {
  const lock = `${trustPath()}.lock`;
  const token = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await writeFile(lock, token, { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
    }
    const age = await stat(lock).then(
      (info) => Date.now() - info.mtimeMs,
      () => 0,
    );
    if (age > STALE_LOCK_MS) {
      await rm(lock, { force: true });
      continue;
    }
    if (Date.now() > deadline)
      throw new ProjectError(
        `Another Code Factory process holds ${lock}. Try again, or remove the file if no Code Factory is running.`,
        503,
      );
    await new Promise((resolveWait) => setTimeout(resolveWait, 10 + Math.random() * 40));
  }
  try {
    return await work();
  } finally {
    const holder = await readFile(lock, "utf8").catch(() => null);
    if (holder === token) await rm(lock, { force: true });
  }
};

/**
 * A trust folder inside the project would let the project's own files decide whether it is
 * trusted, so it is refused rather than read.
 */
const assertTrustOutside = async (project: string): Promise<void> => {
  const directory = trustDirectory();
  if (isWithin(await canonicalPath(project), await canonicalPath(directory)))
    throw new ProjectError(
      `Code Factory's trust folder ${directory} is inside this project, which could then trust itself. Set CODE_FACTORY_HOME to an absolute folder outside the project.`,
      409,
    );
};

/** Create the trust folder private to the user, and make an existing shared one private. */
const ensureTrustDirectory = async (): Promise<void> => {
  const directory = trustDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32" && (await stat(directory)).mode & 0o022)
    await chmod(directory, 0o700);
};

/** Decisions are keyed by the project's real path, so a symlinked spelling finds the same entry. */
const projectKey = async (project: string): Promise<string> =>
  realpath(project).catch(() => resolve(project));

const readTrustFile = async (): Promise<TrustFile> => {
  const path = trustPath();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isCode(error, "ENOENT")) return { schemaVersion: 1, projects: {} };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const result = trustFileSchema.safeParse(parsed);
  // A corrupt file is reported, never reset: resetting would silently drop the user's decisions.
  if (!result.success)
    throw new ProjectError(`Invalid trust file at ${path}. Repair or remove it.`, 500);
  return result.data;
};

/**
 * Write through a private temporary file and rename, so a crash never leaves half a file. The
 * temporary name is unique per write, so concurrent writers never share one.
 */
const writeTrustFile = async (file: TrustFile): Promise<void> => {
  const path = trustPath();
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
};

const updateEntry = async (
  directory: string,
  change: (current: ProjectTrustEntry | undefined) => ProjectTrustEntry | undefined,
): Promise<ProjectTrustEntry | undefined> => {
  const project = await projectKey(directory);
  await assertTrustOutside(project);
  return withTrustFile(trustPath(), async () => {
    await ensureTrustDirectory();
    return withTrustFileLock(async () => {
      const file = await readTrustFile();
      const current = file.projects[project];
      const next = change(current);
      if (next === current) return current;
      const { [project]: _previous, ...others } = file.projects;
      await writeTrustFile({ ...file, projects: next ? { ...others, [project]: next } : others });
      return next;
    });
  });
};

/** The trust entry for a project, or undefined when it is not trusted. */
export const readProjectTrust = async (project: string): Promise<ProjectTrustEntry | undefined> => {
  const key = await projectKey(project);
  await assertTrustOutside(key);
  return (await readTrustFile()).projects[key];
};

export const isProjectTrusted = async (project: string): Promise<boolean> =>
  Boolean(await readProjectTrust(project));

/** Idempotent: an existing decision keeps its original date and grants. */
export const trustProject = (project: string, now = new Date()) =>
  updateEntry(project, (current) => current ?? { trustedAt: now.toISOString() });

/** Forget the decision and every tool grant that came with it. */
export const untrustProject = (project: string) => updateEntry(project, () => undefined);

export const projectNotTrusted = () =>
  new ProjectError("Trust this project before Code Factory runs anything in it.", 403);

/** Store the provider's fixed scope. Idempotent: an existing grant keeps its original date. */
export const grantToolPermission = async (
  project: string,
  provider: GrantableProvider,
  now = new Date(),
): Promise<ToolGrants> => {
  const entry = await updateEntry(project, (current) => {
    if (!current) throw projectNotTrusted();
    if (current.toolGrants?.[provider]) return current;
    const grantedAt = now.toISOString();
    const toolGrants: ToolGrants = {
      ...current.toolGrants,
      ...(provider === "kiro"
        ? { kiro: { scope: [...TOOL_GRANT_SCOPE.kiro], grantedAt } }
        : provider === "codex"
          ? { codex: { scope: [...TOOL_GRANT_SCOPE.codex], grantedAt } }
          : { "claude-code": { scope: [...TOOL_GRANT_SCOPE["claude-code"]], grantedAt } }),
    };
    return { ...current, toolGrants };
  });
  return entry?.toolGrants ?? {};
};

/** Remove the provider's grant. Idempotent without a grant or without trust. */
export const revokeToolPermission = async (
  project: string,
  provider: GrantableProvider,
): Promise<ToolGrants> => {
  const entry = await updateEntry(project, (current) => {
    if (!current?.toolGrants?.[provider]) return current;
    const { [provider]: _removed, ...rest } = current.toolGrants;
    const { toolGrants: _grants, ...withoutGrants } = current;
    return Object.keys(rest).length ? { ...withoutGrants, toolGrants: rest } : withoutGrants;
  });
  return entry?.toolGrants ?? {};
};
