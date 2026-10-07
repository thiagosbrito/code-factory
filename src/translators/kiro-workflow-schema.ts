import { z } from "zod";
import { TranslationError, type TranslationIssue } from "./contract.js";

export type KiroStopCondition = {
  containsText?: string | undefined;
  fileCheck?:
    | { path: string; jsonPath: string; value: string | number | boolean | null }
    | undefined;
};
export type KiroStep = {
  type: "step";
  id: string;
  agent: string;
  prompt: string;
  modelId?: string | undefined;
  effortLevel?: string | undefined;
  artifacts?: Record<string, string> | undefined;
  captureOutput?: boolean | undefined;
  completion?: unknown;
};
export type KiroSequence = { type: "sequence"; id: string; steps: KiroNode[] };
export type KiroParallel = {
  type: "parallel";
  id: string;
  branches: KiroNode[];
  joinPolicy: "all" | "allSettled" | "any";
};
export type KiroRepeat = {
  type: "repeat";
  id: string;
  steps: KiroNode[];
  maxIterations: number;
  onMaxIterations: "abort" | "continue" | "pause";
  stopCondition?: KiroStopCondition | undefined;
  stopWhen?: unknown;
};
export type KiroWatch = { type: "watch"; id: string; handler: string; config?: unknown };
export type KiroNode = KiroStep | KiroSequence | KiroParallel | KiroRepeat | KiroWatch;
export type KiroWorkflow = {
  name: string;
  description?: string | undefined;
  inputs: Record<string, string>;
  modelId?: string | undefined;
  effortLevel?: string | undefined;
  steps: KiroNode[];
};

const maxDepth = 16;
const maxNodes = 500;
const maxListedIssues = 5;
const nodeTypes = ["step", "sequence", "parallel", "repeat", "watch"] as const;
type NodeType = (typeof nodeTypes)[number];

const rootKeys = new Set(["name", "description", "inputs", "modelId", "effortLevel", "steps"]);
const knownKeys: Record<NodeType, ReadonlySet<string>> = {
  step: new Set([
    "type",
    "id",
    "agent",
    "prompt",
    "modelId",
    "effortLevel",
    "artifacts",
    "captureOutput",
    "completion",
  ]),
  sequence: new Set(["type", "id", "steps"]),
  parallel: new Set(["type", "id", "branches", "joinPolicy"]),
  repeat: new Set([
    "type",
    "id",
    "steps",
    "maxIterations",
    "onMaxIterations",
    "stopCondition",
    "stopWhen",
  ]),
  watch: new Set(["type", "id", "handler", "config"]),
};
const childKey: Partial<Record<NodeType, string>> = {
  sequence: "steps",
  parallel: "branches",
  repeat: "steps",
};

/** Renders `["steps", 3, "branches", 0, "prompt"]` as `steps[3].branches[0].prompt`. */
export const formatIssuePath = (path: readonly PropertyKey[]): string => {
  const rendered = path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`))
    .join("")
    .replace(/^\./, "");
  return rendered || "workflow";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeType = (value: unknown): value is NodeType =>
  typeof value === "string" && nodeTypes.some((type) => type === value);

const describeRaw = (value: unknown): string => {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.slice(0, 40);
};

const unknownKeyIssues = (
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  path: readonly PropertyKey[],
): TranslationIssue[] =>
  Object.keys(value)
    .filter((key) => !known.has(key))
    .map((key) => ({
      field: formatIssuePath([...path, key]),
      kind: "unsupported",
      message: "Unknown Kiro field is not imported.",
    }));

/**
 * Iterative pre-order walk before zod, so hostile nesting cannot overflow `z.lazy`
 * recursion. It descends only through known child keys of known node types.
 */
const guardStructure = (value: unknown): TranslationIssue[] => {
  if (!isRecord(value)) return [];
  const issues = unknownKeyIssues(value, rootKeys, []);
  type Pending = { node: unknown; path: PropertyKey[]; depth: number };
  const children = (list: unknown, path: PropertyKey[], depth: number): Pending[] =>
    Array.isArray(list)
      ? list.map((node: unknown, index) => ({ node, path: [...path, index], depth }))
      : [];
  const stack = children(value["steps"], ["steps"], 1).reverse();
  let count = 0;
  for (let next = stack.pop(); next; next = stack.pop()) {
    const { node, path, depth } = next;
    if (depth > maxDepth)
      throw new TranslationError(
        `${formatIssuePath(path)}: Kiro workflow nesting exceeds ${maxDepth} levels.`,
      );
    count++;
    if (count > maxNodes)
      throw new TranslationError(`Kiro workflow has more than ${maxNodes} nodes.`);
    if (!isRecord(node) || !isNodeType(node["type"])) continue;
    const type = node["type"];
    issues.push(...unknownKeyIssues(node, knownKeys[type], path));
    const key = childKey[type];
    if (key) stack.push(...children(node[key], [...path, key], depth + 1).reverse());
  }
  return issues;
};

const idSchema = z.string().trim().min(1).max(128);
const optionalText = z.string().min(1).optional();
const stopConditionSchema = z
  .strictObject({
    containsText: z.string().optional(),
    fileCheck: z
      .strictObject({
        path: z.string(),
        jsonPath: z.string(),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      })
      .optional(),
  })
  .refine((condition) => Object.keys(condition).length > 0, {
    message: "stopCondition needs containsText or fileCheck",
  });

const nodeSchema: z.ZodType<KiroNode> = z.lazy(() =>
  z.discriminatedUnion(
    "type",
    [
      z.object({
        type: z.literal("step"),
        id: idSchema,
        agent: z.string().min(1),
        prompt: z.string(),
        modelId: optionalText,
        effortLevel: optionalText,
        artifacts: z.record(z.string(), z.string()).optional(),
        captureOutput: z.boolean().optional(),
        completion: z.unknown().optional(),
      }),
      z.object({ type: z.literal("sequence"), id: idSchema, steps: z.array(nodeSchema).min(1) }),
      z.object({
        type: z.literal("parallel"),
        id: idSchema,
        branches: z.array(nodeSchema).min(1),
        joinPolicy: z.enum(["all", "allSettled", "any"]),
      }),
      z
        .object({
          type: z.literal("repeat"),
          id: idSchema,
          steps: z.array(nodeSchema).min(1),
          maxIterations: z.number().int().min(1).max(1000),
          onMaxIterations: z.enum(["abort", "continue", "pause"]),
          stopCondition: stopConditionSchema.optional(),
          stopWhen: z.unknown().optional(),
        })
        .superRefine((node, context) => {
          if (node.stopCondition !== undefined && node.stopWhen !== undefined)
            context.addIssue({
              code: "custom",
              path: ["stopWhen"],
              message: "use either stopCondition or stopWhen, not both",
            });
        }),
      z.object({
        type: z.literal("watch"),
        id: idSchema,
        handler: z.string(),
        config: z.unknown().optional(),
      }),
    ],
    {
      error: (issue) =>
        issue.code === "invalid_union" && isRecord(issue.input)
          ? `unknown Kiro node type "${describeRaw(issue.input["type"])}"; expected step, sequence, parallel, repeat or watch`
          : undefined,
    },
  ),
);

const workflowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().optional(),
  inputs: z.record(z.string(), z.string()),
  modelId: optionalText,
  effortLevel: optionalText,
  steps: z.array(nodeSchema).min(1),
});

export const parseKiroWorkflow = (
  content: string,
): { workflow: KiroWorkflow; issues: TranslationIssue[] } => {
  if (content.includes("\0")) throw new TranslationError("Kiro workflow contains invalid bytes.");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TranslationError(`Kiro workflow is not valid JSON: ${reason}`);
  }
  const issues = guardStructure(value);
  const parsed = workflowSchema.safeParse(value);
  if (!parsed.success)
    throw new TranslationError(
      `Invalid Kiro workflow: ${parsed.error.issues
        .slice(0, maxListedIssues)
        .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
        .join("; ")}`,
    );
  return { workflow: parsed.data, issues };
};
