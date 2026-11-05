import * as Schema from "effect/Schema";

import {
  CommandId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const WayfinderTicketType = Schema.Literals(["grilling", "research", "prototype", "task"]);
export type WayfinderTicketType = typeof WayfinderTicketType.Type;

export const WayfinderTicketStatus = Schema.Literals([
  "open",
  "claimed",
  "resolved",
  "out_of_scope",
]);
export type WayfinderTicketStatus = typeof WayfinderTicketStatus.Type;

export const WayfinderProblemReason = Schema.Literals([
  "unreadable",
  "invalid-filename",
  "missing-frontmatter",
  "invalid-frontmatter",
  "invalid-type",
  "missing-question",
  "missing-done-when",
  "both-closing-headings",
  "duplicate-number",
  "missing-title",
  "missing-destination",
]);
export type WayfinderProblemReason = typeof WayfinderProblemReason.Type;

/** `path` is relative to the snapshot root with forward slashes; clients display it as is. */
export const WayfinderProblem = Schema.Struct({
  path: Schema.String,
  reason: WayfinderProblemReason,
});
export type WayfinderProblem = typeof WayfinderProblem.Type;

export const WayfinderTicketSummary = Schema.Struct({
  number: NonNegativeInt,
  slug: Schema.String,
  title: Schema.String,
  type: Schema.NullOr(WayfinderTicketType),
  status: WayfinderTicketStatus,
  frontier: Schema.Boolean,
  blockedBy: Schema.Array(NonNegativeInt),
  underminedBy: Schema.Array(NonNegativeInt),
  assets: Schema.Array(Schema.String),
  /** Raw frontmatter text, so foreign session ids never fail decoding. */
  claimedBy: Schema.NullOr(Schema.String),
  /** Raw frontmatter text, so bad timestamps never fail decoding. */
  claimedAt: Schema.NullOr(Schema.String),
  /** Hash of the file bytes; compare for equality only. */
  fingerprint: Schema.String,
  problems: Schema.Array(WayfinderProblem),
});
export type WayfinderTicketSummary = typeof WayfinderTicketSummary.Type;

export const WayfinderMapSummary = Schema.Struct({
  slug: Schema.String,
  title: Schema.String,
  /** Hash of the `map.md` bytes; compare for equality only. */
  fingerprint: Schema.String,
  tickets: Schema.Array(WayfinderTicketSummary),
  frontier: Schema.Array(NonNegativeInt),
  problems: Schema.Array(WayfinderProblem),
});
export type WayfinderMapSummary = typeof WayfinderMapSummary.Type;

export const WayfinderMapsSnapshot = Schema.Struct({
  cwd: Schema.String,
  /** The git top-level of `cwd`, or `cwd` when there is none. */
  root: Schema.String,
  maps: Schema.Array(WayfinderMapSummary),
  problems: Schema.Array(WayfinderProblem),
});
export type WayfinderMapsSnapshot = typeof WayfinderMapsSnapshot.Type;

export const WayfinderSubscribeInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type WayfinderSubscribeInput = typeof WayfinderSubscribeInput.Type;

/** Every push carries the whole snapshot. The union stays open for a later delta member. */
export const WayfinderSubscribeEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", { snapshot: WayfinderMapsSnapshot }),
]);
export type WayfinderSubscribeEvent = typeof WayfinderSubscribeEvent.Type;

export const WayfinderReadTicketInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  mapSlug: TrimmedNonEmptyString,
  number: NonNegativeInt,
});
export type WayfinderReadTicketInput = typeof WayfinderReadTicketInput.Type;

export const WayfinderReadMapInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  mapSlug: TrimmedNonEmptyString,
});
export type WayfinderReadMapInput = typeof WayfinderReadMapInput.Type;

export const WayfinderSection = Schema.Struct({
  heading: Schema.String,
  markdown: Schema.String,
});
export type WayfinderSection = typeof WayfinderSection.Type;

/** One entry per H2 section in file order; `fingerprint` matches the summary's for the bytes read. */
export const WayfinderDocument = Schema.Struct({
  fingerprint: Schema.String,
  title: Schema.String,
  sections: Schema.Array(WayfinderSection),
});
export type WayfinderDocument = typeof WayfinderDocument.Type;

export class WayfinderMapsReadError extends Schema.TaggedError<WayfinderMapsReadError>()(
  "WayfinderMapsReadError",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read the Wayfinder maps for '${this.cwd}'.`;
  }
}

export class WayfinderTicketNotFoundError extends Schema.TaggedError<WayfinderTicketNotFoundError>()(
  "WayfinderTicketNotFoundError",
  {
    mapSlug: Schema.String,
    number: Schema.optional(NonNegativeInt),
  },
) {
  override get message(): string {
    return this.number === undefined
      ? `No Wayfinder map '${this.mapSlug}'.`
      : `No ticket ${this.number} in the Wayfinder map '${this.mapSlug}'.`;
  }
}

export const WayfinderStartTicketThreadInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectId: ProjectId,
  mapSlug: TrimmedNonEmptyString,
  number: NonNegativeInt,
  /** The new thread's id derives from it, so a retry replays instead of starting a second thread. */
  commandId: CommandId,
});
export type WayfinderStartTicketThreadInput = typeof WayfinderStartTicketThreadInput.Type;

export const WayfinderStartTicketThreadResult = Schema.Struct({
  threadId: ThreadId,
  /** The ticket file relative to the snapshot root, with forward slashes. */
  ticketPath: Schema.String,
});
export type WayfinderStartTicketThreadResult = typeof WayfinderStartTicketThreadResult.Type;

export const WayfinderReleaseClaimInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  mapSlug: TrimmedNonEmptyString,
  number: NonNegativeInt,
  /** Releases a claim whose thread is working or waiting on the user. */
  force: Schema.optional(Schema.Boolean),
});
export type WayfinderReleaseClaimInput = typeof WayfinderReleaseClaimInput.Type;

export const WayfinderReleaseClaimResult = Schema.Struct({
  /** `false` when the ticket had no claim. */
  released: Schema.Boolean,
});
export type WayfinderReleaseClaimResult = typeof WayfinderReleaseClaimResult.Type;

export const WayfinderNotStartableReason = Schema.Literals([
  "missing",
  "resolved",
  "out-of-scope",
  "claimed",
  "blocked",
  "problem",
]);
export type WayfinderNotStartableReason = typeof WayfinderNotStartableReason.Type;

const padTicketNumber = (number: number) => String(number).padStart(2, "0");

export class WayfinderTicketNotStartableError extends Schema.TaggedError<WayfinderTicketNotStartableError>()(
  "WayfinderTicketNotStartableError",
  {
    mapSlug: Schema.String,
    number: NonNegativeInt,
    reason: WayfinderNotStartableReason,
    /** Present only for `blocked`: the unresolved or missing blocker numbers. */
    blockers: Schema.optional(Schema.Array(NonNegativeInt)),
    /** Present only for `claimed`. */
    claimedBy: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return `Ticket ${padTicketNumber(this.number)} of the ${this.mapSlug} map is not startable: ${this.reason}.`;
  }
}

export const WayfinderLiveClaimState = Schema.Literals(["working", "needs-you"]);
export type WayfinderLiveClaimState = typeof WayfinderLiveClaimState.Type;

export class WayfinderClaimLiveError extends Schema.TaggedError<WayfinderClaimLiveError>()(
  "WayfinderClaimLiveError",
  {
    number: NonNegativeInt,
    state: WayfinderLiveClaimState,
    threadId: Schema.String,
  },
) {
  override get message(): string {
    return `Ticket ${padTicketNumber(this.number)}'s claim is held by thread ${this.threadId}, which is ${this.state === "working" ? "working" : "waiting on the user"}.`;
  }
}
