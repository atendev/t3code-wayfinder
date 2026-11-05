import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  type EnvironmentId,
  type ProjectId,
  ThreadId,
  type WayfinderMapSummary,
  type WayfinderTicketSummary,
} from "@t3tools/contracts";
import { type ClaimantThread, claimSessionState } from "@t3tools/shared/wayfinderClaim";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { useInlineActionConfirm } from "../../hooks/useInlineActionConfirm";
import { randomUUID } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { useEnvironmentShellHasSnapshot } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  wayfinderClaimantAtom,
  wayfinderReleaseClaim,
  wayfinderStartTicketThread,
} from "../../state/wayfinder";
import { UnresolvedChip } from "../contextChipParts";
import { ThreadContextChip } from "../ThreadContextChip";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  claimStateLine,
  FRONTMATTER_PROBLEM_REASONS,
  liveClaimCopy,
  notStartableCopy,
  padTicketNumber,
} from "./wayfinderCopy";

const DAY_MS = 24 * 60 * 60 * 1000;

function failureCopy(result: unknown, fallback: string): string | null {
  const error = squashAtomCommandFailure(result as never) as {
    readonly _tag?: string;
    readonly message?: string;
  };
  if (error?._tag === "WayfinderTicketNotStartableError") return notStartableCopy(error as never);
  if (error?._tag === "WayfinderClaimLiveError") return liveClaimCopy(error as never);
  return error instanceof Error ? error.message || fallback : fallback;
}

function claimAgeDays(claimedAt: string | null, now: number): number | null {
  const at = claimedAt === null ? Number.NaN : Date.parse(claimedAt);
  return Number.isNaN(at) ? null : Math.floor((now - at) / DAY_MS);
}

/**
 * Keyed by the claimant's inputs and the ticket fingerprint, so a push or shell change remounts
 * it and reads the clock again. No timer watches the 72 h boundary.
 */
function ClaimRow(props: {
  readonly environmentId: EnvironmentId;
  readonly ticket: WayfinderTicketSummary & { readonly claimedBy: string };
  readonly claimant: ClaimantThread | null;
  readonly chipOnly: boolean;
  readonly canRelease: boolean;
  readonly releasing: boolean;
  readonly onRelease: (force: boolean) => void;
}) {
  const { ticket } = props;
  const [now] = useState(Date.now);
  const session = claimSessionState(props.claimant, ticket.claimedAt, now);
  const confirm = useInlineActionConfirm(`wayfinder-release:${ticket.claimedBy}`);
  const days = claimAgeDays(ticket.claimedAt, now);
  const chip =
    session.state === "unattended" && session.reason === "no_thread" ? (
      <UnresolvedChip
        label="No open thread"
        tooltip={`${ticket.claimedBy}${days === null ? "" : `, claimed ${days} days ago`}`}
      />
    ) : (
      <ThreadContextChip
        record={{
          environmentId: props.environmentId,
          threadId: ThreadId.make(ticket.claimedBy),
          title: ticket.claimedBy,
        }}
      />
    );
  if (props.chipOnly) return <div className="flex flex-wrap items-center gap-2">{chip}</div>;
  const live = session.state !== "unattended";
  const releaseLabel = live && confirm.isArmed("release") ? "Confirm release" : "Release";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chip}
      <span className="text-xs text-muted-foreground">{claimStateLine(session, days ?? 0)}</span>
      {props.canRelease ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={props.releasing}
          {...(live
            ? confirm.props("release", () => props.onRelease(true))
            : { onClick: () => props.onRelease(false) })}
        >
          {props.releasing ? <Spinner aria-hidden /> : null}
          {releaseLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** Start and Release for one ticket, with the claimant's session state. */
export function WayfinderTicketActions(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly cwd: string;
  readonly map: WayfinderMapSummary;
  readonly ticket: WayfinderTicketSummary;
}) {
  const { environmentId, map, ticket } = props;
  const router = useRouter();
  const start = useAtomCommand(wayfinderStartTicketThread, { reportFailure: false });
  const release = useAtomCommand(wayfinderReleaseClaim, { reportFailure: false });
  const canStart = useAtomValue(wayfinderStartTicketThread.permissionAtom(environmentId));
  const canRelease = useAtomValue(wayfinderReleaseClaim.permissionAtom(environmentId));
  const shellsLoaded = useEnvironmentShellHasSnapshot(environmentId);
  const claimantKey = useAtomValue(
    wayfinderClaimantAtom(JSON.stringify([environmentId, ticket.claimedBy ?? ""])),
  );
  const [pending, setPending] = useState<"start" | "release" | null>(null);
  // State updates land after the frame, so a second click in the same frame needs this guard.
  const starting = useRef(false);
  const label = padTicketNumber(ticket.number);

  const onStart = async () => {
    if (props.projectId === null || starting.current) return;
    starting.current = true;
    setPending("start");
    const result = await start({
      environmentId,
      input: {
        cwd: props.cwd,
        projectId: props.projectId,
        mapSlug: map.slug,
        number: ticket.number,
        commandId: CommandId.make(randomUUID()),
      },
    });
    starting.current = false;
    setPending(null);
    if (result._tag === "Success") {
      const threadRef = scopeThreadRef(environmentId, result.value.threadId);
      const panel = useRightPanelStore.getState();
      panel.open(threadRef, "wayfinder");
      panel.setWayfinderSelection(threadRef, { mapSlug: map.slug, ticketNumber: ticket.number });
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.value.threadId },
      });
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: `Couldn't start a thread on ${label}.`,
        description: failureCopy(result, "An error occurred.") ?? undefined,
      }),
    );
  };

  const onRelease = async (force: boolean) => {
    setPending("release");
    const result = await release({
      environmentId,
      input: { cwd: props.cwd, mapSlug: map.slug, number: ticket.number, force },
    });
    setPending(null);
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: `Couldn't release the claim on ${label}.`,
        description: failureCopy(result, "An error occurred.") ?? undefined,
      }),
    );
  };

  const closed = ticket.status === "resolved" || ticket.status === "out_of_scope";
  const claimedBy = ticket.claimedBy;
  const claimRow =
    claimedBy === null || !shellsLoaded ? null : (
      <ClaimRow
        key={`${claimantKey}:${ticket.fingerprint}`}
        environmentId={environmentId}
        ticket={{ ...ticket, claimedBy }}
        claimant={JSON.parse(claimantKey) as ClaimantThread | null}
        chipOnly={closed}
        canRelease={canRelease}
        releasing={pending === "release"}
        onRelease={(force) => void onRelease(force)}
      />
    );
  if (closed) return claimRow;

  const resolved = new Set(
    map.tickets.filter((entry) => entry.status === "resolved").map((entry) => entry.number),
  );
  const reason = !canStart
    ? "This connection can't start threads"
    : ticket.problems.some((problem) => FRONTMATTER_PROBLEM_REASONS.has(problem.reason))
      ? "Fix the frontmatter first"
      : ticket.status === "open" && !ticket.frontier
        ? `Blocked by ${ticket.blockedBy
            .filter((blocker) => !resolved.has(blocker))
            .map(padTicketNumber)
            .join(", ")}`
        : ticket.status === "open" && props.projectId === null
          ? "Waiting for this thread's project"
          : null;
  const startable =
    canStart && ticket.status === "open" && ticket.frontier && props.projectId !== null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!startable || pending === "start"} onClick={() => void onStart()}>
          {pending === "start" ? <Spinner aria-hidden /> : null}
          Start thread
        </Button>
        {reason === null ? null : <span className="text-xs text-muted-foreground">{reason}</span>}
      </div>
      {claimRow}
    </div>
  );
}
