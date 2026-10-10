import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { connectionRequestSchema, type ConnectionRequest } from "./connection-request.js";
import { ProjectError } from "./project.js";
import { trustDirectory } from "./trust.js";

/** Which agents a user connected for a project, so a restart can connect them again. */
export type ConnectionMemory = {
  read(): Promise<ConnectionRequest[]>;
  remember(request: ConnectionRequest): Promise<void>;
};

const memoryFileSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.record(z.string(), z.array(connectionRequestSchema)),
});
type MemoryFile = z.infer<typeof memoryFileSchema>;

const memoryPath = () => join(trustDirectory(), "connections.json");

const readFileOrEmpty = async (): Promise<MemoryFile> => {
  const path = memoryPath();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { schemaVersion: 1, projects: {} };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const result = memoryFileSchema.safeParse(parsed);
  // Reported, never reset: the next write would otherwise drop what the user had connected.
  if (!result.success)
    throw new ProjectError(`Invalid connections file at ${path}. Repair or remove it.`, 500);
  return result.data;
};

/**
 * Remembers connections per project in the user-level Code Factory folder, next to the trust
 * decisions and for the same reason: a repository's own files must not decide which programs the
 * runtime launches. Only provider names (and a custom executable path) are stored, never
 * credentials; the provider keeps its own login.
 */
export const userConnectionMemory = (project: string): ConnectionMemory => {
  const key = () => realpath(project).catch(() => resolve(project));
  let queue: Promise<unknown> = Promise.resolve();
  return {
    read: async () => (await readFileOrEmpty()).projects[await key()] ?? [],
    remember: (request) => {
      const write = async () => {
        const file = await readFileOrEmpty();
        const projectKey = await key();
        const known = file.projects[projectKey] ?? [];
        // One entry per provider; a newer custom executable replaces the older one.
        const next = [...known.filter((item) => item.provider !== request.provider), request];
        if (JSON.stringify(next) === JSON.stringify(known)) return;
        await mkdir(trustDirectory(), { recursive: true, mode: 0o700 });
        const path = memoryPath();
        const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await writeFile(
            temporary,
            `${JSON.stringify({ ...file, projects: { ...file.projects, [projectKey]: next } }, null, 2)}\n`,
            { mode: 0o600 },
          );
          await chmod(temporary, 0o600);
          await rename(temporary, path);
        } catch (error) {
          await rm(temporary, { force: true });
          throw error;
        }
      };
      queue = queue.then(write, write);
      return queue as Promise<void>;
    },
  };
};
