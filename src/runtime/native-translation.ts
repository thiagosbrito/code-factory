import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, lstat, open, readdir, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { parseLoop } from "../domain/loop.js";
import { getTranslator, listTranslators } from "../translators/registry.js";
import { ProjectError } from "./project.js";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const nameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const requestSchema = z.strictObject({
  format: z.string(),
  name: nameSchema,
  loop: z.unknown(),
  expectedRevision: z.string().optional(),
});

const translatorFor = (format: string) => {
  try {
    return getTranslator(format);
  } catch {
    throw new ProjectError("Unsupported native configuration format.", 422);
  }
};

const safeDirectory = async (project: string, format: string, create: boolean) => {
  const translator = translatorFor(format);
  const root = await realpath(project);
  let path = root;
  for (const segment of translator.relativeDirectory.split("/")) {
    path = join(path, segment);
    let stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat && create) {
      await mkdir(path);
      stat = await lstat(path);
    }
    if (!stat) return null;
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new ProjectError("Native configuration path contains a link or non-directory.", 409);
    const actual = await realpath(path);
    if (!actual.startsWith(`${root}${sep}`))
      throw new ProjectError("Native configuration path escapes the project.", 409);
  }
  return path;
};

const nativePath = async (project: string, format: string, name: string, create: boolean) => {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) throw new ProjectError("Invalid native rule name.", 400);
  const directory = await safeDirectory(project, format, create);
  if (!directory) return null;
  const translator = translatorFor(format);
  const path = resolve(directory, `${name}${translator.extension}`);
  if (!path.startsWith(`${directory}${sep}`))
    throw new ProjectError("Native path escapes the project.", 400);
  return path;
};

const readNative = async (path: string | null): Promise<string | null> => {
  if (!path) return null;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      if (error.code === "ELOOP") throw new ProjectError("Native rule path is a link.", 409);
      throw error;
    },
  );
  if (!file) return null;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1_048_576)
      throw new ProjectError("Native rule must be a regular file under 1 MB.", 422);
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
};

export const nativeFormats = () =>
  listTranslators().map(({ format, provider, label }) => ({ format, provider, label }));

export const nativeCandidates = async (project: string, format: string) => {
  const directory = await safeDirectory(project, format, false);
  if (!directory) return [];
  const extension = translatorFor(format).extension;
  return (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(extension) &&
        nameSchema.safeParse(entry.name.slice(0, -extension.length)).success,
    )
    .map((entry) => entry.name.slice(0, -extension.length));
};

export const previewNative = async (
  project: string,
  input: unknown,
  direction: "import" | "export",
) => {
  const request = requestSchema.parse(input);
  const translator = translatorFor(request.format);
  const loop = parseLoop(request.loop);
  if (loop.status !== "draft") throw new ProjectError("Native translation requires a draft.", 422);
  const relativePath = `${translator.relativeDirectory}/${request.name}${translator.extension}`;
  const path = await nativePath(project, request.format, request.name, false);
  const current = await readNative(path);
  const revision = digest(JSON.stringify(loop) + "\0" + (current ?? "<absent>"));
  if (direction === "import") {
    if (current === null) throw new ProjectError("Native rule was not found.", 404);
    const translated = translator.import(current, loop);
    return { ...translated, relativePath, revision, conflicts: [], direction };
  }
  const translated = translator.export(loop);
  return {
    ...translated,
    relativePath,
    revision,
    conflicts:
      current === null
        ? []
        : [
            {
              path: relativePath,
              message: "An existing rule would be overwritten; choose another name.",
            },
          ],
    direction,
  };
};

export const applyNative = async (
  project: string,
  input: unknown,
  direction: "import" | "export",
) => {
  const request = requestSchema.parse(input);
  if (!request.expectedRevision) throw new ProjectError("Preview the native change first.", 428);
  const preview = await previewNative(project, input, direction);
  if (preview.revision !== request.expectedRevision)
    throw new ProjectError("Native rule or draft changed since preview. Preview again.", 409);
  if (preview.conflicts.length) throw new ProjectError("Native rule already exists.", 409);
  if (direction === "import") return preview;
  const path = await nativePath(project, request.format, request.name, true);
  if (!path || !("content" in preview)) throw new ProjectError("Export path is unavailable.", 409);
  const file = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST")
      throw new ProjectError("Native rule was created after preview.", 409);
    throw error;
  });
  try {
    await file.writeFile(preview.content);
  } finally {
    await file.close();
  }
  return preview;
};
