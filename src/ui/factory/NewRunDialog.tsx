import type { LoopDefinition } from "../../domain/loop.js";
import type { ExecutionBinding } from "../../domain/loop.js";
import type { RunRecord } from "../../domain/run.js";
import type { AgentConnection } from "../../adapters/contract.js";
import { Button } from "@/shared/components/button";
import { Input } from "@/shared/components/input";
import { Textarea } from "@/shared/components/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/select";

import { useNewRunForm } from "./useNewRunForm";

export const NewRunDialog = ({
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
}) => {
  const {
    description,
    ticketId,
    ticket,
    ticketState,
    error,
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
    branch,
    branchError,
    suggestedBranch,
    changeBranch,
  } = useNewRunForm({
    loops,
    agents,
    defaultBinding,
    trackerConfigured,
    canStart,
    onStarted,
    onOpenChange,
  });

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
                onValueChange={changeLoop}
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
                onChange={(event) => changeTicket(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void retrieve();
                  }
                }}
                placeholder="e.g. PROJ-123"
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
                The selected agent will read this issue through its configured issue tracker MCP
                (for example Jira or Linear) when the run starts. Connect it in that AI tool first.
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
                optional with a ticket number
              </span>
            </label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(event) => changeDescription(event.target.value)}
              placeholder="Describe the change, constraints and expected outcome…"
            />
          </div>
          <div>
            <label htmlFor="run-branch" className="mb-1 block text-sm font-medium">
              Branch
            </label>
            <Input
              id="run-branch"
              value={branch}
              onChange={(event) => changeBranch(event.target.value)}
              placeholder="code-factory/<run id>"
              aria-describedby={
                branchError ? "run-branch-help run-branch-error" : "run-branch-help"
              }
              aria-invalid={Boolean(branchError) || undefined}
              autoComplete="off"
              spellCheck={false}
            />
            <p id="run-branch-help" className="mt-1 text-xs text-muted-foreground">
              Code Factory creates this new branch in your project and switches your checkout to it;
              each step is committed there. Commit or stash your own changes first. Empty uses
              code-factory/&lt;run id&gt;.
            </p>
            {branchError && (
              <p id="run-branch-error" role="alert" className="mt-1 text-xs text-red-700">
                {branchError}
              </p>
            )}
          </div>
          {!canStart && (
            <p role="alert" className="text-sm text-red-700">
              Verify an authenticated default agent connection before starting.
            </p>
          )}
          {error && (
            <div role="alert" className="text-sm text-red-700">
              <p>{error}</p>
              {suggestedBranch && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => changeBranch(suggestedBranch)}
                >
                  Use {suggestedBranch}
                </Button>
              )}
            </div>
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
};
