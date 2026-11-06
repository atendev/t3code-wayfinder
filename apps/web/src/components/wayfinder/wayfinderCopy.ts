import type {
  WayfinderClaimLiveError,
  WayfinderProblemReason,
  WayfinderTicketNotStartableError,
} from "@t3tools/contracts";
import type { ClaimSessionState } from "@t3tools/shared/wayfinderClaim";

import type { SessionState } from "./starmap/session";

export const PROBLEM_REASON_COPY: Record<WayfinderProblemReason, string> = {
  unreadable: "Can't be read",
  "invalid-filename": "File name has no ticket number",
  "missing-frontmatter": "No frontmatter",
  "invalid-frontmatter": "Frontmatter has an invalid value",
  "invalid-type": "Type isn't grilling, research, prototype, or task",
  "missing-question": "No Question section",
  "missing-done-when": "No Done when section",
  "both-closing-headings": "Has both an Answer and a Ruled out section",
  "duplicate-number": "Another ticket already uses this number",
  "missing-title": "map.md has no title",
  "missing-destination": "map.md has no Destination section",
};

// The client never learns the host's home directory, so this matches the usual home prefixes.
const HOME_PREFIX = /^(?:\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[/\\])/i;

/** Shows a host path with a conventional home-directory prefix as `~`. */
export function tildeRoot(root: string): string {
  return root.replace(HOME_PREFIX, "~");
}

export const FRONTMATTER_PROBLEM_REASONS: ReadonlySet<WayfinderProblemReason> = new Set([
  "missing-frontmatter",
  "invalid-frontmatter",
  "invalid-type",
]);

export const padTicketNumber = (number: number) => String(number).padStart(2, "0");

export function notStartableCopy(error: WayfinderTicketNotStartableError): string {
  switch (error.reason) {
    case "missing":
      return "This ticket file is gone.";
    case "resolved":
      return "This ticket is already resolved.";
    case "out-of-scope":
      return "This ticket is out of scope.";
    case "claimed":
      return "Another thread already claimed this ticket.";
    case "blocked":
      return `Blocked by ${(error.blockers ?? []).map(padTicketNumber).join(", ")}`;
    case "problem":
      return "Fix the frontmatter first";
  }
}

export function liveClaimCopy(error: WayfinderClaimLiveError): string {
  return error.state === "working"
    ? "The claiming thread is working now."
    : "The claiming thread is waiting on you now.";
}

const NEEDS_YOU_COPY = {
  approval: "Needs you: waiting for approval",
  input: "Needs you: awaiting input",
  turn_ended: "Needs you: turn ended",
  failed: "Needs you: failed",
} as const;

export function claimStateLine(session: ClaimSessionState, days: number): string {
  if (session.state === "working") return "Working";
  if (session.state === "needs-you") return NEEDS_YOU_COPY[session.reason];
  return session.reason === "no_thread"
    ? "Unattended: no open thread holds this claim"
    : `Unattended: claimed ${days} days ago`;
}

const SESSION_CLAUSES: ReadonlyArray<readonly [SessionState, string]> = [
  ["working", "working"],
  ["needs_user", "needs you"],
  ["unattended", "unattended"],
];

/** The canvas's one-line screen-reader summary, with a clause per non-zero session state. */
export function canvasSummary(
  title: string,
  ticketCount: number,
  frontierCount: number,
  sessions: Readonly<Record<number, SessionState>>,
): string {
  const parts = [
    title,
    `${ticketCount} ${ticketCount === 1 ? "ticket" : "tickets"}`,
    `${frontierCount} on the frontier`,
  ];
  const states = Object.values(sessions);
  for (const [state, label] of SESSION_CLAUSES) {
    const count = states.filter((entry) => entry === state).length;
    if (count > 0) parts.push(`${count} ${label}`);
  }
  return parts.join(", ");
}
