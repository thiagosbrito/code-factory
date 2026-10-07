import { z } from "zod";

export const ticketIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9]*-[1-9][0-9]*$/, "Enter a ticket ID such as THI-9.");
export const retrievedTicketSchema = z.strictObject({
  id: ticketIdSchema,
  title: z.string().trim().min(1),
  summary: z.string(),
  attachments: z.array(z.strictObject({ title: z.string().min(1), url: z.url() })),
});
export type RetrievedTicket = z.infer<typeof retrievedTicketSchema>;

/** Sentinel an agent emits when its issue tracker MCP cannot read the requested issue. */
export const issueBlockedSentinel = (ticketId: string): string =>
  `BLOCKED: Issue ${ticketId} could not be retrieved`;

/** Runs persisted before the provider-neutral wording used the Jira-specific sentinel. */
const legacyIssueBlockedSentinel = (ticketId: string): string =>
  `BLOCKED: Jira issue ${ticketId} could not be retrieved`;

export const isIssueBlockedOutput = (output: string | undefined, ticketId: string): boolean => {
  const text = output?.trimStart() ?? "";
  return (
    text.startsWith(issueBlockedSentinel(ticketId)) ||
    text.startsWith(legacyIssueBlockedSentinel(ticketId))
  );
};

export const retrievedIssueStart = (ticketId: string): string =>
  `--- Retrieved issue ${ticketId} ---`;
export const retrievedIssueEnd = "--- End retrieved issue ---";

/** Extract the delimited issue details an entry step emitted, including its delimiter lines. */
export const extractRetrievedIssue = (
  output: string | undefined,
  ticketId: string,
): string | undefined => {
  if (!output) return undefined;
  const lines = output.split(/\r?\n/);
  const markers = lines.map((line) => line.trim());
  const start = markers.indexOf(retrievedIssueStart(ticketId));
  if (start < 0) return undefined;
  const end = markers.indexOf(retrievedIssueEnd, start + 1);
  if (end < 0) return undefined;
  const body = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  return body ? [retrievedIssueStart(ticketId), body, retrievedIssueEnd].join("\n") : undefined;
};
