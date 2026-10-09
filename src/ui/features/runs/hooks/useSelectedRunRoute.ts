import { useEffect, useState } from "react";

const runIdFromHash = () => location.hash.match(/^#runs\/([0-9a-f-]{36})$/i)?.[1] ?? "";

/** The run shown in the URL hash, kept in step with browser navigation. */
export const useSelectedRunRoute = () => {
  const [selectedRunId, setSelectedRunId] = useState(runIdFromHash);
  useEffect(() => {
    const navigate = () => setSelectedRunId(runIdFromHash());
    window.addEventListener("popstate", navigate);
    window.addEventListener("hashchange", navigate);
    return () => {
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("hashchange", navigate);
    };
  }, []);
  const openRun = (id: string) => {
    setSelectedRunId(id);
    window.history.pushState(null, "", `#runs/${id}`);
  };
  return { selectedRunId, setSelectedRunId, openRun };
};
