import { useRef, useState } from "react";
import type { LoopDefinition } from "../domain/loop.js";
import type { ExecutionBinding } from "../domain/loop.js";
import type { RunRecord } from "../domain/run.js";
import type { AgentConnection } from "../adapters/contract.js";
import type { RetrievedTicket } from "../runtime/tracker.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "./project-api";
import { bindingError } from "./connection";

type TicketState = "idle" | "loading" | "found" | "not-found" | "auth" | "error";

export function NewRunDialog({
  open,
  onOpenChange,
  projectName,
  loops,
  trackerConfigured,
  canStart,
  agents,
  defaultBinding,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  loops: LoopDefinition[];
  trackerConfigured: boolean;
  canStart: boolean;
  agents: AgentConnection[];
  defaultBinding: ExecutionBinding | null;
  onStarted: (id: string, run?: RunRecord) => void;
}) {
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
    !hasTicketInput || (ticketState === "found" && ticket?.id === ticketId.trim().toUpperCase());

  async function retrieve() {
    const id = ticketId.trim().toUpperCase();
    if (!id) return;
    const sequence = ++requestSequence.current;
    setTicket(null);
    setTicketState("loading");
    setError("");
    try {
      const result = await api<{ ticket: RetrievedTicket }>("/api/tickets/retrieve", {
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
  }

  async function submit(event: React.FormEvent) {
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
      const result = await api<{ runId: string; run?: RunRecord }>("/api/runs", {
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
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          ticketInput.current?.focus();
        }}
      >
        <DialogTitle className="text-xl font-semibold">Start a new run</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          The task, published loop version, resolved agent binding and Git baseline are saved with
          the run.
        </DialogDescription>
        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span id="run-project-label" className="mb-1 block text-sm font-medium">
                Project
              </span>
              <Select value="selected">
                <SelectTrigger aria-labelledby="run-project-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="selected">{projectName}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">CLI selected workspace</p>
            </div>
            <div>
              <span id="loop-label" className="mb-1 block text-sm font-medium">
                Published loop
              </span>
              <Select
                value={selected ? `${selected.id}:${selected.version}` : ""}
                onValueChange={(value) => {
                  setLoopKey(value);
                  requestId.current = crypto.randomUUID();
                }}
              >
                <SelectTrigger aria-labelledby="loop-label">
                  <SelectValue placeholder="Select a published loop" />
                </SelectTrigger>
                <SelectContent>
                  {loops.map((loop) => (
                    <SelectItem
                      key={`${loop.id}:${loop.version}`}
                      value={`${loop.id}:${loop.version}`}
                    >
                      {loop.name} · v{loop.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!selected && (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  No published loop is available.
                </p>
              )}
              {connectionError && (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {connectionError}
                </p>
              )}
            </div>
          </div>
          <div>
            <label htmlFor="ticket-id" className="mb-1 block text-sm font-medium">
              Ticket number <span className="font-normal text-muted-foreground">optional</span>
            </label>
            <div className="flex gap-2">
              <Input
                id="ticket-id"
                ref={ticketInput}
                value={ticketId}
                onChange={(event) => {
                  requestSequence.current++;
                  setTicketId(event.target.value);
                  setTicket(null);
                  setTicketState("idle");
                  setError("");
                  requestId.current = crypto.randomUUID();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void retrieve();
                  }
                }}
                placeholder="e.g. THI-9"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void retrieve()}
                disabled={!trackerConfigured || !hasTicketInput || ticketState === "loading"}
              >
                {ticketState === "loading" ? "Retrieving…" : "Retrieve"}
              </Button>
            </div>
            {!trackerConfigured && (
              <p className="mt-1 text-xs text-muted-foreground">
                Tracker unavailable. Description-only runs remain available.
              </p>
            )}
            {ticketState === "loading" && (
              <output className="mt-2 block text-sm">Loading ticket…</output>
            )}
            {ticket && ticketState === "found" && (
              <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm">
                <strong>
                  {ticket.id} · {ticket.title}
                </strong>
                <p className="mt-1 whitespace-pre-wrap">{ticket.summary}</p>
                {ticket.attachments.length > 0 && (
                  <div className="mt-2">
                    <span className="font-medium">Attachments</span>
                    <ul className="list-inside list-disc">
                      {ticket.attachments.map((attachment) => (
                        <li key={attachment.url}>{attachment.title}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {ticketState === "not-found" && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                Ticket not found. Check its number or clear it.
              </p>
            )}
            {ticketState === "auth" && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                Tracker authentication failed. Reconfigure the tracker or clear the ticket.
              </p>
            )}
            {ticketState === "error" && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                Ticket retrieval failed. Retry or clear the ticket.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="task-description" className="mb-1 block text-sm font-medium">
              Task description{" "}
              <span className="font-normal text-muted-foreground">
                optional with a retrieved ticket
              </span>
            </label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setError("");
                requestId.current = crypto.randomUUID();
              }}
              placeholder="Describe the change, constraints and expected outcome…"
            />
          </div>
          {!canStart && (
            <p role="alert" className="text-sm text-red-700">
              Verify an authenticated default agent connection before starting.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {selected && (
            <p className="rounded-lg border bg-canvas p-3 text-sm">
              {selected.name} · Published v{selected.version} · {selected.steps.length} steps
            </p>
          )}
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                submitting || !selected || !canStart || Boolean(connectionError) || !ticketReady
              }
            >
              {submitting ? "Starting…" : "Start run"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
