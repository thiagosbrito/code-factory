import type { EvidenceSummary } from "../../../../domain/acceptance.js";

/** "Local validation: … · Human acceptance: …", shared by the header and the evidence dialog. */
export const EvidenceStatusText = ({ summary }: { summary: EvidenceSummary | null }) => (
  <>
    Local validation: <strong>{summary?.validation === "passed" ? "Passed" : "Incomplete"}</strong>
    {" · "}Human acceptance: <strong>{summary?.acceptance ?? "Pending"}</strong>
  </>
);
