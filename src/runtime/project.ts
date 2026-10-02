import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { providerIdSchema } from "../domain/loop.js";

export const projectConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1),
  defaultBinding: z
    .strictObject({ provider: providerIdSchema, model: z.string().min(1) })
    .nullable(),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/** Create project configuration exclusively; never replace existing agent files or configuration. */
export async function initializeProject(directory: string): Promise<ProjectConfig> {
  const root = await realpath(directory);
  const config = projectConfigSchema.parse({
    schemaVersion: 1,
    name: basename(root),
    defaultBinding: null,
  });
  await mkdir(join(root, ".code-factory"), { recursive: true });
  await writeFile(
    join(root, ".code-factory", "project.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { flag: "wx" },
  );
  return config;
}

export async function readProjectConfig(directory: string): Promise<ProjectConfig | null> {
  try {
    const content = await readFile(join(directory, ".code-factory", "project.json"), "utf8");
    return projectConfigSchema.parse(JSON.parse(content) as unknown);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
