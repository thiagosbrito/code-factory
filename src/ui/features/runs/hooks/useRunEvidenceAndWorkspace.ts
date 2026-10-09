import { useEffect, useState } from "react";
import type { EvidenceSummary } from "../../../../domain/acceptance.js";
import type { RunWorkspace } from "../../../../domain/run-branch.js";
import { api, evidenceResponseSchema, workspaceResponseSchema } from "../../../shared/project-api";

/** Evidence summary and Git workspace of the selected run, refreshed every two seconds. */
export const useRunEvidenceAndWorkspace = (demo: boolean, selectedRunId: string) => {
  const [evidence, setEvidence] = useState<{ runId: string; summary: EvidenceSummary } | null>(
    null,
  );
  const [workspace, setWorkspace] = useState<{ runId: string; workspace: RunWorkspace } | null>(
    null,
  );
  useEffect(() => {
    if (demo || !selectedRunId) return;
    const refresh = () => {
      void api(`/api/runs/${selectedRunId}/evidence`, evidenceResponseSchema.parse)
        .then(({ summary }) => setEvidence({ runId: selectedRunId, summary }))
        .catch(() => setEvidence(null));
      void api(`/api/runs/${selectedRunId}/workspace`, workspaceResponseSchema.parse)
        .then(({ workspace: next }) => setWorkspace({ runId: selectedRunId, workspace: next }))
        .catch(() => setWorkspace(null));
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [demo, selectedRunId]);
  const refreshWorkspace = async (id: string) => {
    const { workspace: next } = await api(
      `/api/runs/${id}/workspace`,
      workspaceResponseSchema.parse,
    );
    setWorkspace({ runId: id, workspace: next });
  };
  return {
    evidenceSummary: evidence?.runId === selectedRunId ? evidence.summary : null,
    workspace: workspace?.runId === selectedRunId ? workspace.workspace : null,
    setEvidence,
    refreshWorkspace,
  };
};
