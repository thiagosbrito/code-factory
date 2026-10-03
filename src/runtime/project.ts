import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { executionBindingSchema } from "../domain/loop.js";

export const customAgentSchema = z.strictObject({
  executable: z.string().trim().min(1).refine(isAbsolute, "Enter an absolute executable path."),
  protocol: z.literal("codex-app-server"),
});

export const projectConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(120),
  defaultBinding: executionBindingSchema.nullable(),
  customAgent: customAgentSchema.optional(),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export const projectSetupSchema = z.strictObject({
  name: z.string().trim().min(1, "Enter a project name.").max(120),
  revision: z.string().nullable(),
  defaultBinding: executionBindingSchema.nullable().optional(),
  customAgent: customAgentSchema.nullable().optional(),
});

export class ProjectError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function validateProjectDirectory(directory: string): Promise<string> {
  let root: string;
  try {
    root = await realpath(directory);
  } catch (error) {
    if (isCode(error, "ENOENT"))
      throw new ProjectError(`Project path does not exist: ${directory}`, 404);
    if (isCode(error, "EACCES") || isCode(error, "EPERM"))
      throw new ProjectError(
        `Cannot access project path: ${directory}. Check directory permissions.`,
        403,
      );
    throw error;
  }
  try {
    if (!(await stat(root)).isDirectory())
      throw new ProjectError(`Project path is not a directory: ${root}`, 400);
    await access(root, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    if (isCode(error, "EACCES") || isCode(error, "EPERM"))
      throw new ProjectError(
        `Cannot read and write project directory: ${root}. Check permissions.`,
        403,
      );
    throw error;
  }
  return root;
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function storageError(error: unknown, path: string): unknown {
  if (isCode(error, "EACCES") || isCode(error, "EPERM"))
    return new ProjectError(`Cannot access ${path}. Check project permissions.`, 403);
  return error;
}

async function configPath(root: string): Promise<string> {
  const folder = join(root, ".code-factory");
  try {
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new ProjectError(`${folder} must be a regular directory.`, 409);
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw storageError(error, folder);
  }
  const path = join(folder, "project.json");
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new ProjectError(`${path} must be a regular file.`, 409);
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw storageError(error, path);
  }
  return path;
}

export async function readProjectConfig(directory: string): Promise<ProjectConfig | null> {
  const path = await configPath(directory);
  try {
    const content = await readFile(path, "utf8");
    try {
      return projectConfigSchema.parse(JSON.parse(content) as unknown);
    } catch {
      throw new ProjectError(
        `Invalid project configuration at ${path}. Repair it before saving setup.`,
        409,
      );
    }
  } catch (error) {
    if (isCode(error, "ENOENT")) return null;
    throw storageError(error, path);
  }
}

export async function projectRevision(directory: string): Promise<string | null> {
  const path = await configPath(directory);
  try {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch (error) {
    if (isCode(error, "ENOENT")) return null;
    throw storageError(error, path);
  }
}

/** Create project configuration exclusively; never replace existing agent files or configuration. */
export async function initializeProject(directory: string): Promise<ProjectConfig> {
  const root = await validateProjectDirectory(directory);
  const config = projectConfigSchema.parse({
    schemaVersion: 1,
    name: basename(root),
    defaultBinding: null,
  });
  await configPath(root);
  await mkdir(join(root, ".code-factory"), { recursive: true });
  await writeFile(
    join(root, ".code-factory", "project.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { flag: "wx" },
  );
  return config;
}

/** Only the trusted CLI workspace is writable; setup may change its display name. */
export async function saveProjectSetup(
  directory: string,
  input: z.infer<typeof projectSetupSchema>,
): Promise<ProjectConfig> {
  const root = await validateProjectDirectory(directory);
  const path = await configPath(root);
  const current = await readProjectConfig(root);
  if (input.revision !== (await projectRevision(root)))
    throw new ProjectError("Project setup changed on disk. Reload and try again.", 409);
  const config = projectConfigSchema.parse({
    schemaVersion: 1,
    name: input.name,
    defaultBinding:
      input.defaultBinding === undefined ? (current?.defaultBinding ?? null) : input.defaultBinding,
    ...(input.customAgent === undefined
      ? current?.customAgent
        ? { customAgent: current.customAgent }
        : {}
      : input.customAgent
        ? { customAgent: input.customAgent }
        : {}),
  });
  const folder = join(root, ".code-factory");
  try {
    if (!current) {
      await mkdir(folder, { recursive: true });
      try {
        await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
      } catch (error) {
        if (isCode(error, "EEXIST"))
          throw new ProjectError("Project setup was created elsewhere. Reload and try again.", 409);
        throw error;
      }
    } else {
      const temporary = join(folder, `.project-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
        if (input.revision !== (await projectRevision(root)))
          throw new ProjectError("Project setup changed on disk. Reload and try again.", 409);
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    }
  } catch (error) {
    if (isCode(error, "EACCES") || isCode(error, "EPERM") || isCode(error, "EROFS"))
      throw new ProjectError(
        `Cannot save project configuration in ${folder}. Check write permissions.`,
        403,
      );
    if (isCode(error, "ENOSPC"))
      throw new ProjectError(`Cannot save project configuration in ${folder}. Disk is full.`, 507);
    throw error;
  }
  return config;
}
