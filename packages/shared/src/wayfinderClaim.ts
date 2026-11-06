import type { OrchestrationV2RunStatus } from "@t3tools/contracts";

export type ClaimRunStatus = OrchestrationV2RunStatus | "idle";

const ACTIVE_RUN_STATUSES: ReadonlySet<ClaimRunStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

export const runStatusIsActive = (status: ClaimRunStatus): boolean =>
  ACTIVE_RUN_STATUSES.has(status);

export interface ClaimantThread {
  readonly archived: boolean;
  /** `null` when the thread has no runtime yet. */
  readonly runtimeStatus: ClaimRunStatus | null;
  readonly pendingRequest: "approval" | "input" | "subagent" | null;
}

export type ClaimSessionState =
  | { readonly state: "working" }
  | {
      readonly state: "needs-you";
      readonly reason: "approval" | "input" | "turn_ended" | "failed";
    }
  | { readonly state: "unattended"; readonly reason: "no_thread" | "aged" };

const UNATTENDED_AFTER_MS = 72 * 60 * 60 * 1000;

/**
 * The session state of the thread holding a Wayfinder claim, derived on the client and server
 * alike. `claimant` is `null` when no open thread with the claimed id is known here.
 */
export function claimSessionState(
  claimant: ClaimantThread | null,
  claimedAt: string | null,
  now: number,
): ClaimSessionState {
  if (claimant === null || claimant.archived) return { state: "unattended", reason: "no_thread" };
  if (claimant.pendingRequest !== null) {
    return {
      state: "needs-you",
      reason: claimant.pendingRequest === "approval" ? "approval" : "input",
    };
  }
  if (claimant.runtimeStatus !== null && runStatusIsActive(claimant.runtimeStatus)) {
    return { state: "working" };
  }
  const claimedAtMs = claimedAt === null ? Number.NaN : Date.parse(claimedAt);
  if (!Number.isNaN(claimedAtMs) && now - claimedAtMs > UNATTENDED_AFTER_MS) {
    return { state: "unattended", reason: "aged" };
  }
  return {
    state: "needs-you",
    reason: claimant.runtimeStatus === "failed" ? "failed" : "turn_ended",
  };
}
