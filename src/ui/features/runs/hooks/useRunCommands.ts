import { useState } from "react";
import type { EvidenceSummary } from "../../../../domain/acceptance.js";
import {
  acceptedEvidenceResponseSchema,
  api,
  jsonPost,
  runResponseSchema,
} from "../../../shared/project-api";
import { mergeRun, reportLost, type RunFeedback, type SetRuns } from "./run-updates";

const activeElement = (): HTMLElement | null =>
  document.activeElement instanceof HTMLElement ? document.activeElement : null;

type Permissions = (id: string, focusTarget: HTMLElement | null) => Promise<"proceed" | "cancel">;

/** Commands a person issues against a run: execute, cancel, retry, steer, answer, accept. */
export const useRunCommands = ({
  ensurePermissions,
  setRuns,
  setEvidence,
  feedback,
}: {
  ensurePermissions: Permissions;
  setRuns: SetRuns;
  setEvidence: (evidence: { runId: string; summary: EvidenceSummary }) => void;
  feedback: RunFeedback;
}) => {
  const { setNotice } = feedback;
  const [executingRunId, setExecutingRunId] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const execute = async (id: string, focusTarget: HTMLElement | null = activeElement()) => {
    if ((await ensurePermissions(id, focusTarget)) === "cancel") return;
    setExecutingRunId(id);
    setNotice("");
    try {
      const { run } = await api(`/api/runs/${id}/execute`, runResponseSchema.parse, {
        method: "POST",
      });
      setRuns((previous) => mergeRun(previous, id, run));
    } catch (error) {
      reportLost(error, "Execution", feedback);
    } finally {
      setExecutingRunId(null);
    }
  };

  const cancel = async (id: string) => {
    try {
      const { run } = await api(`/api/runs/${id}/cancel`, runResponseSchema.parse, {
        method: "POST",
      });
      setRuns((previous) => previous.map((item) => (item.snapshot.id === id ? run : item)));
    } catch (error) {
      reportLost(error, "Cancellation", feedback);
    }
  };

  const retry = async (
    id: string,
    stepId: string,
    attemptId: string,
    focusTarget: HTMLElement | null = activeElement(),
  ) => {
    if ((await ensurePermissions(id, focusTarget)) === "cancel") return;
    setExecutingRunId(id);
    setNotice("");
    try {
      const { run } = await api(
        `/api/runs/${id}/retry`,
        runResponseSchema.parse,
        jsonPost("POST", { stepId, attemptId }),
      );
      setRuns((previous) => mergeRun(previous, id, run));
    } catch (error) {
      reportLost(error, "Retry", feedback);
    } finally {
      setExecutingRunId(null);
    }
  };

  const sendGuidance = async (
    id: string,
    input: { stepId: string; attemptId: string; message: string },
  ) => {
    const { run } = await api(
      `/api/runs/${id}/guidance`,
      runResponseSchema.parse,
      jsonPost("POST", input),
    );
    setRuns((previous) => mergeRun(previous, id, run));
  };

  const replyToInput = async (
    id: string,
    input: {
      stepId: string;
      attemptId: string;
      requestEvidenceId: string;
      answers: Record<string, { answers: string[] }>;
    },
  ) => {
    const { run } = await api(
      `/api/runs/${id}/input`,
      runResponseSchema.parse,
      jsonPost("POST", input),
    );
    setRuns((previous) => mergeRun(previous, id, run));
  };

  const accept = async (id: string) => {
    setAccepting(true);
    setNotice("");
    try {
      const { run, summary } = await api(
        `/api/runs/${id}/evidence`,
        acceptedEvidenceResponseSchema.parse,
        { method: "POST" },
      );
      setRuns((previous) => mergeRun(previous, id, run));
      setEvidence({ runId: id, summary });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not accept evidence.");
    } finally {
      setAccepting(false);
    }
  };

  return { executingRunId, accepting, execute, cancel, retry, sendGuidance, replyToInput, accept };
};
