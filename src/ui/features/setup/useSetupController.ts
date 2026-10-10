import { useEffect, useRef, useState } from "react";
import type { AgentConnection } from "../../../adapters/contract.js";
import { effortChoices } from "../../../domain/binding-catalog.js";
import type { ProviderId } from "../../../domain/loop.js";
import { formatCommandLine, parseCommandLine } from "../../../domain/project.js";
import {
  bindingError,
  connectionViewModel,
  isNativeProvider,
  type ConnectRequest,
} from "../../shared/connection";
import { api, savedProjectResponseSchema, type ProjectResponse } from "../../shared/project-api";

export type SetupControllerOptions = {
  state: ProjectResponse;
  agents: AgentConnection[];
  onRefreshAgents: () => Promise<void>;
  onConnect: (request: ConnectRequest) => Promise<AgentConnection>;
  onSaved: (state: ProjectResponse) => void;
};

/** The pause after choosing an agent in which the user can still change their mind. */
export const AUTO_CONNECT_DELAY_MS = 500;

/** Local setup draft, connection verification and persistence. */
export const useSetupController = ({
  state,
  agents,
  onRefreshAgents,
  onConnect,
  onSaved,
}: SetupControllerOptions) => {
  const [name, setName] = useState(state.project?.name ?? "");
  const [selected, setSelected] = useState<ProviderId | null>(
    state.project?.defaultBinding?.provider ?? null,
  );
  const [model, setModel] = useState(state.project?.defaultBinding?.model ?? "agent-default");
  const [effort, setEffort] = useState(state.project?.defaultBinding?.effort ?? "");
  const [customExecutable, setCustomExecutable] = useState(
    state.project?.customAgent?.executable ?? "",
  );
  const savedSetupCommand = state.project?.setupCommand
    ? formatCommandLine(state.project.setupCommand)
    : "";
  const [setupCommand, setSetupCommand] = useState(savedSetupCommand);
  const [bindingChanged, setBindingChanged] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // True from choosing an agent until its automatic connection starts or is cancelled.
  const [connectPending, setConnectPending] = useState(false);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const displayedAgents: AgentConnection[] = agents.map((item) => {
    if (item.provider !== "custom" || item.executable === customExecutable.trim()) return item;
    return {
      provider: "custom",
      executable: null,
      installation: "missing",
      authentication: "unknown",
      capabilities: {
        streaming: "unknown",
        steering: "unknown",
        resume: "unknown",
        pause: "unknown",
        waitingInput: "unknown",
      },
      reason: "Verify the current executable and protocol to connect.",
    };
  });
  const activeConnection = displayedAgents.find((item) => item.provider === selected);
  const active = activeConnection ? connectionViewModel(activeConnection) : undefined;
  const savedBinding = state.project?.defaultBinding;
  const availableEfforts = effortChoices(activeConnection, model);
  const draftBinding = selected
    ? { provider: selected, model, ...(effort ? { effort } : {}) }
    : null;
  const validation = bindingError(draftBinding, displayedAgents);
  useEffect(() => {
    nameRef.current?.focus();
    return () => clearTimeout(connectTimer.current);
  }, []);
  const cancelPendingConnect = () => {
    clearTimeout(connectTimer.current);
    setConnectPending(false);
  };
  const selectAgent = (provider: ProviderId | null) => {
    // Choosing another agent within the pause cancels the first one's connection.
    cancelPendingConnect();
    const target = displayedAgents.find((item) => item.provider === provider);
    if (
      provider &&
      isNativeProvider(provider) &&
      target &&
      !connectionViewModel(target).connected &&
      target.installation === "detected"
    ) {
      setConnectPending(true);
      connectTimer.current = setTimeout(() => {
        setConnectPending(false);
        void verify(provider);
      }, AUTO_CONNECT_DELAY_MS);
    }
    setSelected(provider);
    setModel("agent-default");
    setEffort("");
    setBindingChanged(true);
    setError("");
  };
  const changeCustomExecutable = (value: string) => {
    setCustomExecutable(value);
    setModel("agent-default");
    setEffort("");
    setBindingChanged(true);
    setError("");
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter a project name.");
      nameRef.current?.focus();
      return;
    }
    if (bindingChanged && validation) {
      setError(validation);
      return;
    }
    if (customExecutable.trim() && !customExecutable.trim().startsWith("/")) {
      setError("Enter an absolute custom executable path.");
      return;
    }
    const parsedSetup = parseCommandLine(setupCommand);
    if (!parsedSetup.ok) {
      setError(parsedSetup.error);
      return;
    }
    const setupChanged = setupCommand !== savedSetupCommand;
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/project/setup", savedProjectResponseSchema.parse, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          revision: state.revision,
          ...(bindingChanged ? { defaultBinding: draftBinding } : {}),
          ...(customExecutable.trim()
            ? { customAgent: { executable: customExecutable.trim(), protocol: "codex-app-server" } }
            : {}),
          // Omitted keeps the saved command; null clears it.
          ...(setupChanged
            ? { setupCommand: parsedSetup.argv.length ? parsedSetup.argv : null }
            : {}),
        }),
      });
      onSaved({ ...state, ...result });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save setup. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const refreshAgents = async () => {
    setRefreshing(true);
    setError("");
    try {
      await onRefreshAgents();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not recheck agents. Try again.");
    } finally {
      setRefreshing(false);
    }
  };
  const verify = async (provider: ProviderId | null = selected) => {
    cancelPendingConnect();
    if (!provider || (!isNativeProvider(provider) && provider !== "custom")) return;
    setVerifying(true);
    setError("");
    try {
      const connection = await onConnect(
        isNativeProvider(provider)
          ? { provider, launch: true }
          : {
              provider: "custom",
              launch: true,
              executable: customExecutable.trim(),
              protocol: "codex-app-server",
            },
      );
      if (provider === "custom" && connection.executable)
        setCustomExecutable(connection.executable);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not verify agent connection.");
    } finally {
      setVerifying(false);
    }
  };
  return {
    setupCommand,
    setSetupCommand,
    name,
    setName,
    selected,
    model,
    setModel,
    effort,
    setEffort,
    customExecutable,
    bindingChanged,
    setBindingChanged,
    verifying,
    connectPending,
    error,
    setError,
    busy,
    refreshing,
    nameRef,
    displayedAgents,
    active,
    savedBinding,
    availableEfforts,
    validation,
    selectAgent,
    changeCustomExecutable,
    save,
    refreshAgents,
    verify,
  };
};
