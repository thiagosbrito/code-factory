import { useRef, useState } from "react";
import type { RunRecord } from "../../../../domain/run.js";
import {
  providersNeedingToolGrant,
  type GrantableProvider,
} from "../../../../domain/tool-grant.js";
import type { ProjectTrust } from "../../../../domain/trust.js";
import {
  api,
  ApiError,
  jsonPost,
  projectResponseSchema,
  trustResponseSchema,
  type ProjectPatch,
} from "../../../shared/project-api";
import type { ToolGrantChoice, ToolGrantPrompt } from "../../../shared/ToolGrantDialog";
import type { TrustChoice, TrustPrompt } from "../../../shared/TrustDialog";
import { reportLost, type RunFeedback } from "./run-updates";

/**
 * Before anything runs: ask once to trust the project, then once per grantable provider without
 * a stored grant. Neither decision is ever sent along with execute.
 */
export const useRunPermissions = (
  runs: RunRecord[],
  feedback: RunFeedback,
  onProjectChanged?: (next: ProjectPatch) => void,
) => {
  const [toolGrantPrompt, setToolGrantPrompt] = useState<ToolGrantPrompt | null>(null);
  // Resolves the promise ensurePermissions is awaiting for the current provider.
  const promptResolver = useRef<((choice: "proceed" | "decline" | "cancel") => void) | null>(null);
  const declinedProviders = useRef(new Set<GrantableProvider>()); // page session only
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const [trustPrompt, setTrustPrompt] = useState<TrustPrompt | null>(null);
  const trustResolver = useRef<((choice: "proceed" | "cancel") => void) | null>(null);
  // Trust returned by the trust request, so the grant prompts that follow see it immediately.
  const latestTrust = useRef<ProjectTrust | null>(null);

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
      reportLost(error, "Execution", feedback);
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

  return {
    ensurePermissions,
    trustPrompt,
    answerTrust,
    toolGrantPrompt,
    answerToolGrant,
    toolGrantReturnFocus: () => returnFocusTo.current,
  };
};
