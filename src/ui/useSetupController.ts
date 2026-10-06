import { useEffect, useRef, useState } from "react";
import type { AgentConnection } from "../adapters/contract.js";
import type { ProviderId } from "../domain/loop.js";
import { bindingError, connectionViewModel } from "./connection";
import { api, savedProjectResponseSchema, type ProjectResponse } from "./project-api";

export type SetupControllerOptions = {
  state: ProjectResponse;
  agents: AgentConnection[];
  onRefreshAgents: () => Promise<void>;
  onConnect: (
    request:
      | { provider: "codex"; launch: true }
      | { provider: "kiro"; launch: true }
      | { provider: "custom"; launch: true; executable: string; protocol: "codex-app-server" },
  ) => Promise<AgentConnection>;
  onSaved: (state: ProjectResponse) => void;
};

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
  const [bindingChanged, setBindingChanged] = useState(false);
  const [verifying, setVerifying] = useState(false);
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
      capabilities: { streaming: "unknown", steering: "unknown", resume: "unknown" },
      reason: "Verify the current executable and protocol to connect.",
    };
  });
  const activeConnection = displayedAgents.find((item) => item.provider === selected);
  const active = activeConnection ? connectionViewModel(activeConnection) : undefined;
  const savedBinding = state.project?.defaultBinding;
  const activeModel = activeConnection?.models?.find((item) => item.id === model);
  const availableEfforts = activeModel?.efforts ?? [];
  const draftBinding = selected
    ? { provider: selected, model, ...(effort ? { effort } : {}) }
    : null;
  const validation = bindingError(draftBinding, displayedAgents);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const selectAgent = (provider: ProviderId | null) => {
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
  const verify = async () => {
    if (selected !== "codex" && selected !== "kiro" && selected !== "custom") return;
    setVerifying(true);
    setError("");
    try {
      const connection = await onConnect(
        selected === "codex" || selected === "kiro"
          ? { provider: selected, launch: true }
          : {
              provider: "custom",
              launch: true,
              executable: customExecutable.trim(),
              protocol: "codex-app-server",
            },
      );
      if (selected === "custom" && connection.executable)
        setCustomExecutable(connection.executable);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not verify agent connection.");
    } finally {
      setVerifying(false);
    }
  };
  return {
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
