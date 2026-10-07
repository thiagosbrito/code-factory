import { ZodError } from "zod";
import { parseLoop } from "../domain/loop.js";
import { TranslationError, type ConfigurationTranslator } from "./contract.js";
import { mapKiroWorkflow } from "./kiro-workflow-mapper.js";
import { parseKiroWorkflow } from "./kiro-workflow-schema.js";

/** Import-only translator for Kiro workflow recipes (`.kiro/workflows/<name>.workflow.json`). */
export const kiroWorkflowTranslator: ConfigurationTranslator = {
  format: "kiro-workflow-json",
  provider: "kiro",
  label: "Kiro workflow",
  relativeDirectory: ".kiro/workflows",
  extension: ".workflow.json",
  import: (content, draft) => {
    if (
      draft.steps.length ||
      draft.dependencies.length ||
      draft.groups.length ||
      draft.joins.length ||
      draft.decisions.length
    )
      throw new TranslationError("Import requires an empty draft to preserve existing steps.");
    const parsed = parseKiroWorkflow(content);
    const mapped = mapKiroWorkflow(parsed.workflow, draft.policy);
    try {
      const loop = parseLoop({ ...draft, ...mapped.loop });
      return { loop, report: { issues: [...parsed.issues, ...mapped.issues] } };
    } catch (error) {
      // A rejected mapper result is a defect, but it is reported clearly instead of a 500.
      if (error instanceof ZodError)
        throw new TranslationError(
          `Kiro workflow could not be represented as a valid loop: ${error.issues
            .map(({ message }) => message)
            .join("; ")}`,
        );
      throw error;
    }
  },
};
