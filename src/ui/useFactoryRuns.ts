import { useEffect, useRef, useState } from "react";
import type { LoopDefinition } from "../domain/loop.js";
import type { RunRecord } from "../domain/run.js";
import type { EvidenceSummary } from "../domain/acceptance.js";
import {
  api,
  ApiError,
  publishedLoopsResponseSchema,
  runsResponseSchema,
  trackerStatusResponseSchema,
  runResponseSchema,
  executionEventSchema,
  evidenceResponseSchema,
  acceptedEvidenceResponseSchema,
  projectResponseSchema,
  promoteErrorSchema,
  promoteResponseSchema,
  trustResponseSchema,
  workspaceResponseSchema,
  type ProjectPatch,
} from "./project-api";
import { mergeRunEvent, mergeRunSnapshot } from "./run-events";
import type { RunWorkspace } from "../domain/run-branch.js";
import { providersNeedingToolGrant, type GrantableProvider } from "../domain/tool-grant.js";
import type { ToolGrantChoice, ToolGrantPrompt } from "./ToolGrantDialog";
import type { TrustChoice, TrustPrompt } from "./TrustDialog";
import type { ProjectTrust } from "../domain/trust.js";
import type { PromoteFailure } from "./PromoteRunDialog";

const jsonPost = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Runtime data and run navigation owned by the factory screen. */
export const useFactoryRuns = (
  demo: boolean,
  options: { onProjectChanged?: (next: ProjectPatch) => void } = {},
) => {
  const { onProjectChanged } = options;
  const [workspace, setWorkspace] = useState<{ runId: string; workspace: RunWorkspace } | null>(
    null,
  );
  const [toolGrantPrompt, setToolGrantPrompt] = useState<ToolGrantPrompt | null>(null);
  // Resolves the promise ensureToolGrants is awaiting for the current provider.
  const promptResolver = useRef<((choice: "proceed" | "decline" | "cancel") => void) | null>(null);
  const declinedProviders = useRef(new Set<GrantableProvider>()); // page session only
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const [trustPrompt, setTrustPrompt] = useState<TrustPrompt | null>(null);
  const trustResolver = useRef<((choice: "proceed" | "cancel") => void) | null>(null);
  // Trust returned by the trust request, so the grant prompts that follow see it immediately.
  const latestTrust = useRef<ProjectTrust | null>(null);
  const [notice, setNotice] = useState("");
  const [publishedLoops, setPublishedLoops] = useState<LoopDefinition[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [trackerConfigured, setTrackerConfigured] = useState(false);
  const [executingRunId, setExecutingRunId] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [stream, setStream] = useState<{ runId: string; connected: boolean } | null>(null);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">("loading");
  const [historyError, setHistoryError] = useState("");
  const [evidence, setEvidence] = useState<{ runId: string; summary: EvidenceSummary } | null>(
    null,
  );
  const [accepting, setAccepting] = useState(false);
  // The runtime's own answer: unfinished, but not being executed (for example after a restart).
  const [interrupted, setInterrupted] = useState<{ runId: string; value: boolean } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState(
    () => location.hash.match(/^#runs\/([0-9a-f-]{36})$/i)?.[1] ?? "",
  );
  const selectedRun = runs.find((run) => run.snapshot.id === selectedRunId);
  const pollingRunId = selectedRunId || executingRunId;
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
  useEffect(() => {
    if (demo) return;
    void Promise.all([
      api("/api/loops/published", publishedLoopsResponseSchema.parse).catch(() => ({ loops: [] })),
      api("/api/runs", runsResponseSchema.parse),
      api("/api/tracker", trackerStatusResponseSchema.parse).catch(() => ({ configured: false })),
    ])
      .then(([loops, history, tracker]) => {
        setPublishedLoops(loops.loops);
        setRuns(history.runs);
        setTrackerConfigured(tracker.configured);
        setHistoryState("ready");
        setHistoryError("");
        setConnected(true);
      })
      .catch((error: unknown) => {
        setHistoryState("error");
        setHistoryError(error instanceof Error ? error.message : "Could not load run history.");
        setConnected(false);
      });
  }, [demo]);
  useEffect(() => {
    if (demo || selectedRunId || historyState !== "ready") return;
    const timer = window.setInterval(() => {
      void api("/api/runs", runsResponseSchema.parse)
        .then(({ runs: history }) => {
          setRuns((previous) =>
            history.map((run) => {
              const existing = previous.find((item) => item.snapshot.id === run.snapshot.id);
              return existing ? mergeRunSnapshot(existing, run) : run;
            }),
          );
          setConnected(true);
        })
        .catch(() => setConnected(false));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [demo, selectedRunId, historyState]);
  useEffect(() => {
    const navigate = () =>
      setSelectedRunId(location.hash.match(/^#runs\/([0-9a-f-]{36})$/i)?.[1] ?? "");
    window.addEventListener("popstate", navigate);
    window.addEventListener("hashchange", navigate);
    return () => {
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("hashchange", navigate);
    };
  }, []);
  useEffect(() => {
    if (!pollingRunId || demo) return;
    const refresh = () => {
      void api(`/api/runs/${pollingRunId}`, runResponseSchema.parse)
        .then(({ run, interrupted: stopped }) => {
          setInterrupted({ runId: pollingRunId, value: Boolean(stopped) });
          setRuns((previous) => {
            const existing = previous.find((item) => item.snapshot.id === pollingRunId);
            return existing
              ? previous.map((item) =>
                  item.snapshot.id === pollingRunId ? mergeRunSnapshot(item, run) : item,
                )
              : [run, ...previous];
          });
        })
        .then(() => setConnected(true))
        .catch(() => setConnected(false));
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [demo, pollingRunId]);
  useEffect(() => {
    if (demo || !selectedRunId || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/runs/${selectedRunId}/events`);
    source.onopen = () => setStream({ runId: selectedRunId, connected: true });
    source.onerror = () => setStream({ runId: selectedRunId, connected: false });
    source.addEventListener("execution-event", (message) => {
      try {
        const event = executionEventSchema.parse(JSON.parse((message as MessageEvent).data));
        setRuns((previous) =>
          previous.map((item) =>
            item.snapshot.id === selectedRunId ? mergeRunEvent(item, event) : item,
          ),
        );
      } catch {
        setStream({ runId: selectedRunId, connected: false });
      }
    });
    source.addEventListener("run-state", (message) => {
      try {
        const run = runResponseSchema.shape.run.parse(JSON.parse((message as MessageEvent).data));
        setRuns((previous) =>
          previous.map((item) =>
            item.snapshot.id === selectedRunId ? mergeRunSnapshot(item, run) : item,
          ),
        );
      } catch {
        setStream({ runId: selectedRunId, connected: false });
      }
    });
    return () => source.close();
  }, [demo, selectedRunId]);
  const openRun = (id: string) => {
    setSelectedRunId(id);
    window.history.pushState(null, "", `#runs/${id}`);
  };
  const reload = () => {
    setHistoryState("loading");
    void api("/api/runs", runsResponseSchema.parse)
      .then(({ runs: history }) => {
        setRuns(history);
        setHistoryState("ready");
        setHistoryError("");
        setConnected(true);
      })
      .catch((error: unknown) => {
        setHistoryState("error");
        setHistoryError(error instanceof Error ? error.message : "Could not load run history.");
        setConnected(false);
      });
  };
  const onStarted = (id: string, run?: RunRecord) => {
    openRun(id);
    if (run) {
      setRuns((previous) => [run, ...previous.filter((item) => item.snapshot.id !== id)]);
      return;
    }
    void api(`/api/runs/${id}`, runResponseSchema.parse)
      .then(({ run }) =>
        setRuns((previous) => [run, ...previous.filter((item) => item.snapshot.id !== id)]),
      )
      .catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : "Could not load run."),
      );
  };
  const refreshWorkspace = async (id: string) => {
    const { workspace: next } = await api(
      `/api/runs/${id}/workspace`,
      workspaceResponseSchema.parse,
    );
    setWorkspace({ runId: id, workspace: next });
  };
  const reportLost = (error: unknown) => {
    if (error instanceof ApiError) setNotice(error.message);
    else {
      setConnected(false);
      setNotice("Connection lost. Execution state is unknown; reconnect to inspect this run.");
    }
  };
  /**
   * Before anything runs: ask once to trust the project, then once per grantable provider without
   * a stored grant. Neither decision is ever sent along with execute.
   */
  const ensurePermissions = async (
    id: string,
    focusTarget: HTMLElement | null,
  ): Promise<"proceed" | "cancel"> => {
    const run = runs.find((item) => item.snapshot.id === id);
    if (!run) return "proceed";
    returnFocusTo.current = focusTarget;
    let project;
    try {
      project = await api("/api/project", projectResponseSchema.parse);
    } catch (error) {
      reportLost(error);
      return "cancel";
    }
    onProjectChanged?.(project);
    let trust = project.trust;
    if (!trust.trusted) {
      const choice = await new Promise<"proceed" | "cancel">((resolve) => {
        trustResolver.current = resolve;
        setTrustPrompt({ review: trust.review, pending: false, error: "" });
      });
      setTrustPrompt(null);
      if (choice === "cancel") return "cancel";
      trust = latestTrust.current ?? trust;
    }
    const outstanding = providersNeedingToolGrant(run, trust.toolGrants).filter(
      (provider) => !declinedProviders.current.has(provider),
    );
    for (const provider of outstanding) {
      const choice = await new Promise<"proceed" | "decline" | "cancel">((resolve) => {
        promptResolver.current = resolve;
        setToolGrantPrompt({ provider, pending: false, error: "" });
      });
      if (choice === "cancel") {
        setToolGrantPrompt(null);
        return "cancel";
      }
    }
    setToolGrantPrompt(null);
    return "proceed";
  };
  const answerTrust = async (choice: TrustChoice): Promise<void> => {
    const prompt = trustPrompt;
    const resolve = trustResolver.current;
    if (!prompt || !resolve) return;
    if (choice === "cancel") {
      trustResolver.current = null;
      resolve("cancel");
      return;
    }
    setTrustPrompt({ ...prompt, pending: true, error: "" });
    try {
      const { trust } = await api(
        "/api/project/trust",
        trustResponseSchema.parse,
        jsonPost("POST", { acknowledged: true }),
      );
      latestTrust.current = trust;
      onProjectChanged?.({ trust });
      trustResolver.current = null;
      resolve("proceed");
    } catch (error) {
      setTrustPrompt({
        ...prompt,
        pending: false,
        error:
          error instanceof ApiError
            ? error.message
            : "Connection lost. The project was not trusted; try again.",
      });
    }
  };
  const answerToolGrant = async (choice: ToolGrantChoice): Promise<void> => {
    const prompt = toolGrantPrompt;
    const resolve = promptResolver.current;
    if (!prompt || !resolve) return;
    if (choice === "cancel") {
      promptResolver.current = null;
      resolve("cancel");
      return;
    }
    if (choice === "decline") {
      declinedProviders.current.add(prompt.provider);
      promptResolver.current = null;
      resolve("decline");
      return;
    }
    setToolGrantPrompt({ ...prompt, pending: true, error: "" });
    try {
      const { trust } = await api(
        "/api/project/tool-grants",
        trustResponseSchema.parse,
        jsonPost("POST", { provider: prompt.provider, acknowledged: true }),
      );
      onProjectChanged?.({ trust });
      promptResolver.current = null;
      resolve("proceed");
    } catch (error) {
      setToolGrantPrompt({
        ...prompt,
        pending: false,
        error:
          error instanceof ApiError
            ? error.message
            : "Connection lost. The permission was not saved; try again.",
      });
    }
  };
  const activeElement = (): HTMLElement | null =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const execute = async (id: string, focusTarget: HTMLElement | null = activeElement()) => {
    if ((await ensurePermissions(id, focusTarget)) === "cancel") return;
    setExecutingRunId(id);
    setNotice("");
    try {
      const { run } = await api(`/api/runs/${id}/execute`, runResponseSchema.parse, {
        method: "POST",
      });
      setRuns((previous) =>
        previous.map((item) => (item.snapshot.id === id ? mergeRunSnapshot(item, run) : item)),
      );
    } catch (error) {
      if (error instanceof ApiError) setNotice(error.message);
      else {
        setConnected(false);
        setNotice("Connection lost. Execution state is unknown; reconnect to inspect this run.");
      }
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
      if (error instanceof ApiError) setNotice(error.message);
      else {
        setConnected(false);
        setNotice("Connection lost. Cancellation state is unknown; reconnect to inspect this run.");
      }
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
      const { run } = await api(`/api/runs/${id}/retry`, runResponseSchema.parse, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, attemptId }),
      });
      setRuns((previous) =>
        previous.map((item) => (item.snapshot.id === id ? mergeRunSnapshot(item, run) : item)),
      );
    } catch (error) {
      if (error instanceof ApiError) setNotice(error.message);
      else {
        setConnected(false);
        setNotice("Connection lost. Retry state is unknown; reconnect to inspect this run.");
      }
    } finally {
      setExecutingRunId(null);
    }
  };
  const sendGuidance = async (
    id: string,
    input: { stepId: string; attemptId: string; message: string },
  ) => {
    const { run } = await api(`/api/runs/${id}/guidance`, runResponseSchema.parse, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    setRuns((previous) =>
      previous.map((item) => (item.snapshot.id === id ? mergeRunSnapshot(item, run) : item)),
    );
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
    const { run } = await api(`/api/runs/${id}/input`, runResponseSchema.parse, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    setRuns((previous) =>
      previous.map((item) => (item.snapshot.id === id ? mergeRunSnapshot(item, run) : item)),
    );
  };
  const promote = async (
    id: string,
    branch: string,
  ): Promise<PromoteFailure | { warning?: string }> => {
    try {
      const { run, warning } = await api(
        `/api/runs/${id}/promote`,
        promoteResponseSchema.parse,
        jsonPost("POST", { branch }),
      );
      setRuns((previous) =>
        previous.map((item) => (item.snapshot.id === id ? mergeRunSnapshot(item, run) : item)),
      );
      await refreshWorkspace(id).catch(() => undefined);
      return warning ? { warning } : {};
    } catch (error) {
      if (error instanceof ApiError) {
        const body = promoteErrorSchema.safeParse(error.body);
        return body.success ? body.data : { error: error.message };
      }
      return { error: "Connection lost. The branch may not have been created; reload the run." };
    }
  };
  const returnCheckout = async (id: string): Promise<string | null> => {
    try {
      const { run } = await api(`/api/runs/${id}/checkout/return`, runResponseSchema.parse, {
        method: "POST",
      });
      setRuns((previous) =>
        previous.map((item) => (item.snapshot.id === id ? mergeRunSnapshot(item, run) : item)),
      );
      await refreshWorkspace(id).catch(() => undefined);
      return null;
    } catch (error) {
      return error instanceof ApiError
        ? error.message
        : "Connection lost. The checkout state is unknown; reload the run.";
    }
  };
  const removeWorktree = async (id: string): Promise<string | null> => {
    try {
      const { run } = await api(`/api/runs/${id}/worktree/remove`, runResponseSchema.parse, {
        method: "POST",
      });
      setRuns((previous) =>
        previous.map((item) => (item.snapshot.id === id ? mergeRunSnapshot(item, run) : item)),
      );
      await refreshWorkspace(id).catch(() => undefined);
      return null;
    } catch (error) {
      return error instanceof ApiError
        ? error.message
        : "Connection lost. Removal state is unknown; reload the run.";
    }
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
      setRuns((previous) =>
        previous.map((item) => (item.snapshot.id === id ? mergeRunSnapshot(item, run) : item)),
      );
      setEvidence({ runId: id, summary });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not accept evidence.");
    } finally {
      setAccepting(false);
    }
  };
  return {
    notice,
    setNotice,
    publishedLoops,
    setPublishedLoops,
    runs,
    trackerConfigured,
    selectedRun,
    setSelectedRunId,
    openRun,
    onStarted,
    execute,
    cancel,
    retry,
    sendGuidance,
    replyToInput,
    accept,
    accepting,
    evidenceSummary: evidence?.runId === selectedRunId ? evidence.summary : null,
    workspace: workspace?.runId === selectedRunId ? workspace.workspace : null,
    promote,
    removeWorktree,
    returnCheckout,
    toolGrantPrompt,
    answerToolGrant,
    trustPrompt,
    answerTrust,
    selectedRunInterrupted: interrupted?.runId === selectedRunId && interrupted.value,
    toolGrantReturnFocus: () => returnFocusTo.current,
    executingRunId,
    connected,
    streamConnected: stream?.runId === selectedRunId ? stream.connected : null,
    historyState,
    historyError,
    reload,
    selectedRunId,
  };
};
