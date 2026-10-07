import type { LoopDefinition } from "../domain/loop.js";

type LoopStage = NonNullable<LoopDefinition["steps"][number]["stage"]>;

const maxIdLength = 64;
export const maxJsonLength = 8_000;

const trimTrailingDash = (value: string): string => value.replace(/-+$/, "");

/** Turns a Kiro id into a loop identifier (`^[a-z][a-z0-9-]{0,63}$`). */
export const normalizeId = (raw: string): string => {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "step";
  const prefixed = /^[a-z]/.test(slug) ? slug : `k-${slug}`;
  return trimTrailingDash(prefixed.slice(0, maxIdLength)) || "step";
};

/** Reserves a collision-free id in `taken`, appending `-2`, `-3`… within 64 characters. */
export const uniqueId = (base: string, taken: Set<string>): string => {
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix++) {
    const tail = `-${suffix}`;
    candidate = `${trimTrailingDash(base.slice(0, maxIdLength - tail.length))}${tail}`;
  }
  taken.add(candidate);
  return candidate;
};

export const humanize = (raw: string): string => {
  const words = raw
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words ? `${words[0]?.toUpperCase() ?? ""}${words.slice(1)}` : raw;
};

const stageRules: readonly { tokens: readonly string[]; stage: LoopStage }[] = [
  { tokens: ["review", "reviews", "reviewer"], stage: "review" },
  { tokens: ["reader"], stage: "evidence" },
  { tokens: ["design", "plan", "planner"], stage: "planning" },
  { tokens: ["implement", "implementation", "integrate"], stage: "implementation" },
];

/**
 * Whole-token stage inference. Stage changes scheduler behavior (review steps are
 * non-writers with fixed verdicts), so substrings such as "preview" never match.
 */
export const inferStage = (agent: string, id: string): LoopStage | undefined => {
  const tokens = new Set(`${agent} ${id}`.toLowerCase().split(/[^a-z0-9]+/));
  return stageRules.find((rule) => rule.tokens.some((token) => tokens.has(token)))?.stage;
};

/**
 * Indented JSON kept whole up to `maxJsonLength` characters. Callers report `truncated`.
 * Input depth is already bounded by the boundary parser, so `JSON.stringify` cannot overflow.
 */
export const boundedJson = (
  value: unknown,
): { text: string; length: number; truncated: boolean } => {
  const text = JSON.stringify(value, null, 2) ?? "null";
  const truncated = text.length > maxJsonLength;
  return {
    text: truncated ? `${text.slice(0, maxJsonLength)}…` : text,
    length: text.length,
    truncated,
  };
};
