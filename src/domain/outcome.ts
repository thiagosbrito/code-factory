/**
 * Agents are asked to put their verdict or decision on the first line, but they often decorate
 * it: `**pass**`, `` `repair` ``, `Verdict: pass.`. This reads that line the way a person would,
 * so a correct answer is not rejected over formatting. Anything else stays as written.
 */
export const firstLineOutcome = (output: string): string => {
  const line = output.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return line
    .replace(/^[#>*_`\s-]+/, "")
    .replace(/[*_`\s]+$/, "")
    .replace(/^(verdict|outcome|decision|result)\s*:\s*/i, "")
    .replace(/[*_`]/g, "")
    .replace(/[.!]+$/, "")
    .trim()
    .toLowerCase();
};

/** The declared outcome named on the first line, or null when the agent did not name one. */
export const declaredOutcome = (output: string, allowed: readonly string[]): string | null => {
  const outcome = firstLineOutcome(output);
  return allowed.includes(outcome) ? outcome : null;
};
