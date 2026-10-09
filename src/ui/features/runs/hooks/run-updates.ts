import type { Dispatch, SetStateAction } from "react";
import type { RunRecord } from "../../../../domain/run.js";
import { ApiError } from "../../../shared/project-api";
import { mergeRunSnapshot } from "../run-events";

export type SetRuns = Dispatch<SetStateAction<RunRecord[]>>;

/** The screen-level state a failed request reports into. */
export type RunFeedback = {
  setConnected: (connected: boolean) => void;
  setNotice: (notice: string) => void;
};

/** Folds a fresh server snapshot into the matching run, keeping locally merged evidence. */
export const mergeRun = (runs: RunRecord[], id: string, run: RunRecord): RunRecord[] =>
  runs.map((item) => (item.snapshot.id === id ? mergeRunSnapshot(item, run) : item));

/** A runtime answer becomes a notice; anything else means the connection dropped mid-action. */
export const reportLost = (error: unknown, subject: string, feedback: RunFeedback) => {
  if (error instanceof ApiError) feedback.setNotice(error.message);
  else {
    feedback.setConnected(false);
    feedback.setNotice(
      `Connection lost. ${subject} state is unknown; reconnect to inspect this run.`,
    );
  }
};
