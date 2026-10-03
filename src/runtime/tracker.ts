import { z } from "zod";
import { ProjectError } from "./project.js";

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
export type TicketTracker = { retrieve(id: string): Promise<RetrievedTicket> };

/** The token is supplied to the process; it is never stored in project files or API responses. */
export function linearTracker(apiKey: string): TicketTracker {
  return {
    async retrieve(input) {
      const id = ticketIdSchema.parse(input).toUpperCase();
      let response: Response;
      try {
        response = await fetch("https://api.linear.app/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: apiKey },
          body: JSON.stringify({
            query:
              "query($id: String!) { issue(id: $id) { identifier title description attachments { nodes { title url } } } }",
            variables: { id },
          }),
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        throw new ProjectError("Tracker request failed. Retry retrieval.", 502);
      }
      if (response.status === 401 || response.status === 403)
        throw new ProjectError(
          "Tracker authentication failed. Check the configured connection.",
          401,
        );
      if (!response.ok) throw new ProjectError("Tracker request failed. Retry retrieval.", 502);
      const result = (await response.json().catch(() => {
        throw new ProjectError("Tracker returned an invalid response. Retry retrieval.", 502);
      })) as {
        data?: {
          issue?: {
            identifier: string;
            title: string;
            description?: string | null;
            attachments?: { nodes: { title: string; url: string }[] };
          } | null;
        };
        errors?: { message?: string; extensions?: { code?: string } }[];
      };
      if (
        result.errors?.some((error) =>
          /auth|unauthorized|token/i.test(`${error.extensions?.code ?? ""} ${error.message ?? ""}`),
        )
      )
        throw new ProjectError(
          "Tracker authentication failed. Check the configured connection.",
          401,
        );
      if (result.errors?.length)
        throw new ProjectError("Tracker request failed. Retry retrieval.", 502);
      if (!result.data?.issue) throw new ProjectError(`Ticket ${id} was not found.`, 404);
      return retrievedTicketSchema.parse({
        id: result.data.issue.identifier,
        title: result.data.issue.title,
        summary: result.data.issue.description ?? "",
        attachments: result.data.issue.attachments?.nodes ?? [],
      });
    },
  };
}
