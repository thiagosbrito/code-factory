import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import type { RunRecord } from "../domain/run.js";
import type { ConnectionRegistry, LaunchAuthorizer } from "./connections.js";
import { ProjectError } from "./project.js";
import type { TicketTracker } from "./tracker.js";

/**
 * Sent with every response. The UI may never be framed by another page (clickjacking), runs only
 * its own bundled scripts, and talks only to this runtime. Styles allow inline because a dialog
 * dependency injects a style element; scripts stay strict.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};

export const readBody = async (request: IncomingMessage): Promise<unknown> => {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 1_048_576) throw new ProjectError("Request body is too large.", 413);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new ProjectError("Send valid JSON.", 400);
  }
};

/** Maps a failed request to its response; a response already started is simply ended. */
export const respondWithError = (response: ServerResponse, error: unknown): void => {
  if (!response.headersSent)
    json(
      response,
      error instanceof ProjectError ? error.status : error instanceof ZodError ? 422 : 500,
      {
        error:
          error instanceof ProjectError
            ? error.message
            : error instanceof ZodError
              ? error.issues.map((issue) => issue.message).join("; ")
              : "Runtime request failed",
      },
    );
  else response.end();
  console.error(error instanceof Error ? error.message : "Unknown runtime error");
};

/** What every route handler receives, built once per request after the session checks pass. */
export type RouteContext = {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly pathname: string;
  /** The request URL, parsed against the loopback host. */
  readonly url: URL;
  readonly allowedOrigins: readonly string[];
  readonly projectDirectory: string;
  readonly connections: ConnectionRegistry;
  readonly tracker: TicketTracker | undefined;
  readonly authorizeLaunch: LaunchAuthorizer;
  readonly disconnectedProvider: (run: RunRecord) => string | undefined;
};

/** Resolves true once it has answered the request; false leaves the request for the next route. */
export type RouteHandler = (ctx: RouteContext) => Promise<boolean>;
