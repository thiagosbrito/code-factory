import type { LoopDefinition } from "../domain/loop.js";

export type TranslationIssue = {
  field: string;
  kind: "unsupported" | "lossy";
  message: string;
};

export type TranslationReport = { issues: TranslationIssue[] };

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
  export(loop: LoopDefinition): { content: string; report: TranslationReport };
}
