import { useRef, useState } from "react";
import type { AgentConnection } from "../adapters/contract.js";
import type { ExecutionBinding, LoopDefinition } from "../domain/loop.js";
import type { RunRecord } from "../domain/run.js";
import type { RetrievedTicket } from "../domain/ticket.js";
import { bindingError } from "./connection";
import { api, ApiError, ticketResponseSchema, startedRunResponseSchema } from "./project-api";

type TicketState = "idle" | "loading" | "found" | "not-found" | "auth" | "error";

/** Ticket retrieval and idempotent run submission for the new-run form. */
export const useNewRunForm = ({
  loops,
  agents,
  defaultBinding,
  trackerConfigured,
  canStart,
  onStarted,
  onOpenChange,
}: {
  loops: LoopDefinition[];
  agents: AgentConnection[];
  defaultBinding: ExecutionBinding | null;
  trackerConfigured: boolean;
  canStart: boolean;
  onStarted: (id: string, run?: RunRecord) => void;
  onOpenChange: (open: boolean) => void;
}) => {
  const [loopKey, setLoopKey] = useState("");
  const [description, setDescription] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [ticket, setTicket] = useState<RetrievedTicket | null>(null);
  const [ticketState, setTicketState] = useState<TicketState>("idle");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestSequence = useRef(0);
  const ticketInput = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const selected = loops.find((loop) => `${loop.id}:${loop.version}` === loopKey) ?? loops[0];
  const connectionError = selected?.steps
    .map((step) => bindingError(step.binding ?? defaultBinding, agents))
    .find(Boolean);
  const hasTicketInput = Boolean(ticketId.trim());
  const ticketReady =
    !hasTicketInput ||
    !trackerConfigured ||
    (ticketState === "found" && ticket?.id === ticketId.trim().toUpperCase());

  const retrieve = async () => {
    const id = ticketId.trim().toUpperCase();
    if (!id) return;
    const sequence = ++requestSequence.current;
    setTicket(null);
    setTicketState("loading");
    setError("");
    try {
      const result = await api("/api/tickets/retrieve", ticketResponseSchema.parse, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (sequence !== requestSequence.current) return;
      setTicket(result.ticket);
      setTicketState("found");
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setTicketState(
        caught instanceof ApiError && caught.status === 404
          ? "not-found"
          : caught instanceof ApiError && caught.status === 401
            ? "auth"
            : "error",
      );
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitLock.current) return;
    if (!selected) return setError("Publish a loop before starting a run.");
    if (!description.trim() && !hasTicketInput)
      return setError("Enter a description or retrieve a ticket.");
    if (!ticketReady)
      return setError("Retrieve this ticket, or clear it to start from the description.");
    if (!canStart || connectionError)
      return setError(connectionError ?? "Verify the selected agent connection before starting.");
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    try {
      const result = await api("/api/runs", startedRunResponseSchema.parse, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: requestId.current,
          project: "selected",
          loopId: selected.id,
          loopVersion: selected.version,
          description: description.trim(),
          ...(hasTicketInput ? { ticketId: ticketId.trim().toUpperCase() } : {}),
        }),
      });
      onStarted(result.runId, result.run);
      requestId.current = crypto.randomUUID();
      setDescription("");
      setTicketId("");
      setTicket(null);
      setTicketState("idle");
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the run.");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const changeLoop = (value: string) => {
    setLoopKey(value);
    requestId.current = crypto.randomUUID();
  };
  const changeTicket = (value: string) => {
    requestSequence.current++;
    setTicketId(value);
    setTicket(null);
    setTicketState("idle");
    setError("");
    requestId.current = crypto.randomUUID();
  };
  const changeDescription = (value: string) => {
    setDescription(value);
    setError("");
    requestId.current = crypto.randomUUID();
  };
  return {
    loopKey,
    setLoopKey,
    description,
    setDescription,
    ticketId,
    setTicketId,
    ticket,
    setTicket,
    ticketState,
    setTicketState,
    error,
    setError,
    submitting,
    ticketInput,
    selected,
    connectionError,
    hasTicketInput,
    ticketReady,
    retrieve,
    submit,
    changeLoop,
    changeTicket,
    changeDescription,
  };
};
