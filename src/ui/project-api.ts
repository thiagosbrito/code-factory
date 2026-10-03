import type { ProjectConfig } from "../runtime/project.js";

export type ProjectResponse = {
  project: ProjectConfig | null;
  path: string;
  revision: string | null;
};
export type FactoryResponse = { loops: number; runs: number };

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const data: unknown = await response.json();
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}
