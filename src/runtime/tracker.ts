import { z } from "zod";
import { ProjectError } from "./project.js";

import { retrievedTicketSchema, ticketIdSchema, type RetrievedTicket } from "../domain/ticket.js";
export { retrievedTicketSchema, ticketIdSchema } from "../domain/ticket.js";
export type { RetrievedTicket } from "../domain/ticket.js";

const trackerResponseSchema = z.object({
  data: z
    .object({
      issue: z
        .object({
          identifier: z.string(),
          title: z.string(),
          description: z.string().nullable().optional(),
          attachments: z
            .object({ nodes: z.array(z.object({ title: z.string(), url: z.string() })) })
            .optional(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        message: z.string().optional(),
        extensions: z.object({ code: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

export type TicketTracker = { retrieve(id: string): Promise<RetrievedTicket> };

/** The token is supplied to the process; it is never stored in project files or API responses. */
export const linearTracker = (apiKey: string): TicketTracker => {
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
      const raw: unknown = await response.json().catch(() => {
        throw new ProjectError("Tracker returned an invalid response. Retry retrieval.", 502);
      });
      const parsed = trackerResponseSchema.safeParse(raw);
      if (!parsed.success)
        throw new ProjectError("Tracker returned an invalid response. Retry retrieval.", 502);
      const result = parsed.data;
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
};
