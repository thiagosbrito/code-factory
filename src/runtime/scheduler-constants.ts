import { type AgentAdapter } from "../adapters/contract.js";

export type Resolver = (provider: string) => AgentAdapter | null;
export const SETUP_TIMEOUT_MS = 900_000;
export const FINISHED_RUN = new Set([
  "succeeded",
  "failed",
  "canceled",
  "rejected",
  "blocked",
  "unavailable",
]);
export const isActiveStatus = (status: string): boolean =>
  status === "running" || status === "waiting-input" || status === "paused";
