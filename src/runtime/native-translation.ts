import { createHash } from "node:crypto";
import { z } from "zod";
import { parseLoop } from "../domain/loop.js";
import { TranslationError } from "../translators/contract.js";
import { getTranslator, listTranslators } from "../translators/registry.js";
import { nativeFile } from "./native-files.js";
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

/**
 * User-correctable translation failures become 422 responses; anything else is a defect.
 * `source` names the native file an import read, so malformed content is locatable.
 */
const translate = <T>(run: () => T, source?: string): T => {
  try {
    return run();
  } catch (error) {
    if (error instanceof TranslationError)
      throw new ProjectError(
        source && !error.aboutDraft ? `${source}: ${error.message}` : error.message,
        422,
      );
    throw error;
  }
};
export const nativeFormats = () =>
  listTranslators().map(({ format, provider, label, export: exporter }) => ({
    format,
    provider,
    label,
    directions: exporter ? (["import", "export"] as const) : (["import"] as const),
  }));

export const nativeCandidates = async (project: string, format: string) => {
  const translator = translatorFor(format);
  const result = await nativeFile({
    project,
    directory: translator.relativeDirectory,
    name: "",
    action: "list",
  });
  return (result.names ?? [])
    .filter((name) => name.endsWith(translator.extension))
    .map((name) => name.slice(0, -translator.extension.length))
    .filter((name) => nameSchema.safeParse(name).success);
};

export const previewNative = async (
  project: string,
  input: unknown,
  direction: "import" | "export",
) => {
  const request = requestSchema.parse(input);
  const translator = translatorFor(request.format);
  const exporter = translator.export;
  const importOnly = () =>
    new ProjectError(`${translator.label} is import-only; export is unsupported.`, 422);
  if (direction === "export" && !exporter) throw importOnly();
  const loop = parseLoop(request.loop);
  if (loop.status !== "draft") throw new ProjectError("Native translation requires a draft.", 422);
  const relativePath = `${translator.relativeDirectory}/${request.name}${translator.extension}`;
  const current =
    (
      await nativeFile({
        project,
        directory: translator.relativeDirectory,
        name: `${request.name}${translator.extension}`,
        action: "read",
      })
    ).content ?? null;
  const revision = digest(JSON.stringify(loop) + "\0" + (current ?? "<absent>"));
  if (direction === "import") {
    if (current === null) throw new ProjectError("Native rule was not found.", 404);
    const translated = translate(() => translator.import(current, loop), relativePath);
    return { ...translated, relativePath, revision, conflicts: [], direction };
  }
  if (!exporter) throw importOnly(); // narrows for the call below
  const translated = translate(() => exporter(loop));
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
  if (!("content" in preview)) throw new ProjectError("Export path is unavailable.", 409);
  const translator = translatorFor(request.format);
  await nativeFile({
    project,
    directory: translator.relativeDirectory,
    name: `${request.name}${translator.extension}`,
    action: "create",
    content: preview.content,
  });
  return preview;
};
