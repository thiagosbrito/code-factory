import type { LoopDefinition } from "../domain/loop.js";

export type TranslationIssue = {
  field: string;
  kind: "unsupported" | "lossy";
  message: string;
};

export type TranslationReport = { issues: TranslationIssue[] };
// Class exception to the arrow-function rule: the runtime needs `instanceof` to map
// user-correctable translation failures to HTTP 422 (same precedent as ProjectError).
/** Thrown for user-correctable native content or draft problems; runtime maps it to 422. */
export class TranslationError extends Error {}

/** Native configuration translation never implies execution or authentication support. */
export interface ConfigurationTranslator {
  readonly format: string;
  readonly provider: string;
  readonly label: string;
  readonly relativeDirectory: string;
  readonly extension: string;
  import(
    content: string,
    draft: LoopDefinition,
  ): { loop: LoopDefinition; report: TranslationReport };
  /** Absent for import-only formats. */
  export?(loop: LoopDefinition): { content: string; report: TranslationReport };
}
