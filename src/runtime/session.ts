import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Loopback is not a user boundary: any local process or other account on the machine can reach
 * 127.0.0.1. Each runtime therefore has a random session token, handed to the browser once through
 * the link `code-factory start` prints and kept in an HttpOnly cookie; every API request needs it.
 */
export const createSessionToken = (): string => randomBytes(32).toString("base64url");

/** Cookies are not port-scoped, so the name carries the port: two runtimes never share one. */
export const sessionCookieName = (port: number): string => `code_factory_session_${port}`;

export const tokenMatches = (expected: string, candidate: string | null | undefined): boolean => {
  if (!candidate) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  return a.length === b.length && timingSafeEqual(a, b);
};

const cookieValue = (header: string | undefined, name: string): string | undefined =>
  header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/** A request carries the session as the runtime's cookie, or as a bearer token for tools. */
export const hasSession = (request: IncomingMessage, token: string, port: number): boolean => {
  const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
  return (
    tokenMatches(token, bearer) ||
    tokenMatches(token, cookieValue(request.headers.cookie, sessionCookieName(port)))
  );
};

export const sessionCookie = (token: string, port: number): string =>
  `${sessionCookieName(port)}=${token}; HttpOnly; SameSite=Strict; Path=/`;
