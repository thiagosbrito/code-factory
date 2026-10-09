import { chmod, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { TOOL_GRANT_SCOPE, type GrantableProvider, type ToolGrants } from "../domain/tool-grant.js";
import { trustFileSchema, type ProjectTrustEntry, type TrustFile } from "../domain/trust.js";
import { createKeyedLock } from "./keyed-lock.js";
import { ProjectError } from "./project.js";

/**
 * The user-level directory for trust decisions: `CODE_FACTORY_HOME`, else the platform's user
 * configuration folder. It is read on every call, so tests and tools can point it elsewhere.
 */
export const trustDirectory = (): string => {
  if (process.env.CODE_FACTORY_HOME) return process.env.CODE_FACTORY_HOME;
  if (process.platform === "win32" && process.env.APPDATA)
    return join(process.env.APPDATA, "code-factory");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "code-factory");
};
const trustPath = () => join(trustDirectory(), "trust.json");
const withTrustFile = createKeyedLock();

/** Decisions are keyed by the project's real path, so a symlinked spelling finds the same entry. */
const projectKey = async (project: string): Promise<string> =>
  realpath(project).catch(() => resolve(project));

const isMissing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const readTrustFile = async (): Promise<TrustFile> => {
  const path = trustPath();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { schemaVersion: 1, projects: {} };
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

/** Write through a private temporary file and rename, so a crash never leaves half a file. */
const writeTrustFile = async (file: TrustFile): Promise<void> => {
  const directory = trustDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = trustPath();
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
};

const updateEntry = async (
  directory: string,
  change: (current: ProjectTrustEntry | undefined) => ProjectTrustEntry | undefined,
): Promise<ProjectTrustEntry | undefined> => {
  const project = await projectKey(directory);
  return withTrustFile(trustPath(), async () => {
    const file = await readTrustFile();
    const current = file.projects[project];
    const next = change(current);
    if (next === current) return current;
    const { [project]: _previous, ...others } = file.projects;
    await writeTrustFile({ ...file, projects: next ? { ...others, [project]: next } : others });
    return next;
  });
};

/** The trust entry for a project, or undefined when it is not trusted. */
export const readProjectTrust = async (project: string): Promise<ProjectTrustEntry | undefined> =>
  (await readTrustFile()).projects[await projectKey(project)];

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
