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
