import type { Doc } from "../_generated/dataModel";

export type RunStatus = Doc<"runs">["status"];

const ALLOWED: Record<RunStatus, RunStatus[]> = {
  queued: ["running", "cancel_requested", "canceled", "failed"],
  running: [
    "waiting_for_approval",
    "waiting_for_external",
    "succeeded",
    "failed",
    "cancel_requested",
    "canceled",
  ],
  waiting_for_approval: [
    "running",
    "succeeded",
    "failed",
    "cancel_requested",
    "canceled",
  ],
  waiting_for_external: [
    "running",
    "succeeded",
    "failed",
    "cancel_requested",
    "canceled",
  ],
  cancel_requested: ["canceled", "succeeded", "failed"],
  succeeded: [],
  failed: ["queued", "running"],
  canceled: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: RunStatus, to: RunStatus) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid run transition ${from} → ${to}`);
  }
}

export function isTerminal(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}
