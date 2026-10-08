/**
 * Changed-files gates: check steps that judge only what a run changed. Code Factory keeps the gate
 * script under `.code-factory/`, so it never counts as a project change and is never committed.
 */
export const CHANGED_FILES_GATE_PATH = ".code-factory/gates/changed-files-gate.mjs";
export const CHANGED_FILES_GATES = ["lint", "types", "coverage"] as const;
export type ChangedFilesGate = (typeof CHANGED_FILES_GATES)[number];

/** Default minimum line coverage, in percent, for every changed source file. */
export const DEFAULT_COVERAGE_THRESHOLD = 90;

/** The shell command a check step runs for one gate. */
export const changedFilesGateCommand = (gate: ChangedFilesGate): string =>
  `node ${CHANGED_FILES_GATE_PATH} ${gate}`;
