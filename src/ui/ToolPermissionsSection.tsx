import { useRef, useState } from "react";
import { GRANTABLE_PROVIDERS, type GrantableProvider } from "../domain/tool-grant.js";
import { Button } from "@/components/ui/button";
import {
  api,
  ApiError,
  savedProjectResponseSchema,
  type ProjectResponse,
  type SavedProjectResponse,
} from "./project-api";
import { SetupSection } from "./SetupSection";
import { ToolGrantDialog, type ToolGrantChoice, type ToolGrantPrompt } from "./ToolGrantDialog";

const providerName: Record<GrantableProvider, string> = {
  kiro: "Kiro",
  codex: "Codex",
  "claude-code": "Claude Code",
};
const grantedText: Record<GrantableProvider, string> = {
  kiro: "shell (execute_bash) allowed",
  codex: "commands inside the project allowed",
  "claude-code": "shell (Bash) allowed",
};
const defaultText: Record<GrantableProvider, string> = {
  kiro: "default tools only (fs_read, fs_write)",
  codex: "default: command approval requests are declined",
  "claude-code": "default: file tools only, Bash denied",
};
const permissionName: Record<GrantableProvider, string> = {
  kiro: "Kiro shell permission",
  codex: "Codex command permission",
  "claude-code": "Claude Code shell permission",
};

/** Setup → Agent tool permission. Rows render from App's project state; nothing is cached. */
export const ToolPermissionsSection = ({
  state,
  onProjectChanged,
}: {
  state: ProjectResponse;
  onProjectChanged: (next: SavedProjectResponse) => void;
}) => {
  const [prompt, setPrompt] = useState<ToolGrantPrompt | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const allowTriggers = useRef<Partial<Record<GrantableProvider, HTMLButtonElement | null>>>({});
  const fallback = useRef<HTMLDivElement>(null);
  const lastProvider = useRef<GrantableProvider | null>(null);
  const focusAfterRevoke = useRef<GrantableProvider | null>(null);
  const grants = state.project?.toolGrants;
  const revoke = async (provider: GrantableProvider) => {
    setError("");
    try {
      const result = await api(
        `/api/project/tool-grants/${provider}`,
        savedProjectResponseSchema.parse,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: state.revision }),
        },
      );
      focusAfterRevoke.current = provider;
      onProjectChanged(result);
      setMessage(`${permissionName[provider]} revoked. New steps use the default tools.`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Connection lost. Permission not changed.",
      );
    }
  };
  const answer = async (choice: ToolGrantChoice) => {
    if (!prompt) return;
    if (choice !== "grant") {
      setPrompt(null);
      return;
    }
    setPrompt({ ...prompt, pending: true, error: "" });
    try {
      const result = await api("/api/project/tool-grants", savedProjectResponseSchema.parse, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: prompt.provider,
          revision: state.revision,
          acknowledged: true,
        }),
      });
      onProjectChanged(result);
      setMessage(`${permissionName[prompt.provider]} allowed for new steps.`);
      setPrompt(null);
    } catch (caught) {
      setPrompt({
        ...prompt,
        pending: false,
        error:
          caught instanceof ApiError
            ? caught.message
            : "Connection lost. The permission was not saved; try again.",
      });
    }
  };
  return (
    <SetupSection
      number={4}
      title="Agent tool permission"
      description="Granted once per project and provider; every new step reuses it until revoked"
    >
      <div ref={fallback} tabIndex={-1} aria-label="Agent tool permission" className="space-y-3">
        <output aria-live="polite" className="sr-only">
          {message}
        </output>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <ul className="space-y-2">
          {GRANTABLE_PROVIDERS.map((provider) => {
            const grant = grants?.[provider];
            return (
              <li
                key={provider}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
              >
                <span>
                  {providerName[provider]}:{" "}
                  {grant
                    ? `${grantedText[provider]} since ${new Date(grant.grantedAt).toLocaleString()}`
                    : defaultText[provider]}
                </span>
                {grant ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`Revoke ${permissionName[provider]}`}
                    onClick={() => void revoke(provider)}
                  >
                    Revoke
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    ref={(element) => {
                      allowTriggers.current[provider] = element;
                      // The focused Revoke button unmounts on success; land on its replacement.
                      if (element && focusAfterRevoke.current === provider) {
                        focusAfterRevoke.current = null;
                        element.focus();
                      }
                    }}
                    aria-label={`Allow ${permissionName[provider]}…`}
                    onClick={() => {
                      setError("");
                      lastProvider.current = provider;
                      setPrompt({ provider, revision: state.revision, pending: false, error: "" });
                    }}
                  >
                    Allow…
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <ToolGrantDialog
        mode="settings"
        prompt={prompt}
        onAnswer={(choice) => void answer(choice)}
        returnFocus={() =>
          lastProvider.current ? (allowTriggers.current[lastProvider.current] ?? null) : null
        }
        fallbackFocus={fallback}
      />
    </SetupSection>
  );
};
