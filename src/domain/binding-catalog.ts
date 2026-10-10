/** The slice of an agent connection a catalog check reads. */
export type BindingCatalog = {
  models?: { id: string; efforts?: string[] | undefined }[] | undefined;
  customModels?: { efforts: string[] } | undefined;
};

/** The part of a binding a connection's catalog can reject. */
export type CatalogProblem = "model" | "effort";

/**
 * Checks a binding's model and effort against what the connection reports. A connection that
 * lists its models is authoritative; one that sets `customModels` (an agent whose CLI takes any
 * model name but has no catalog command) also accepts models it does not list, and its listed
 * `efforts` apply to those and to the agent default.
 */
export const catalogProblem = (
  connection: BindingCatalog,
  binding: { model: string; effort?: string | undefined },
): CatalogProblem | null => {
  const listed = connection.models?.find((item) => item.id === binding.model);
  if (binding.model !== "agent-default" && !listed && !connection.customModels) return "model";
  const efforts = listed?.efforts ?? connection.customModels?.efforts ?? [];
  if (binding.effort && !efforts.includes(binding.effort)) return "effort";
  return null;
};

/** The effort levels a binding's model offers, in the order the agent lists them (light to max). */
export const effortChoices = (connection: BindingCatalog | undefined, model: string): string[] =>
  connection?.models?.find((item) => item.id === model)?.efforts ??
  connection?.customModels?.efforts ??
  [];
