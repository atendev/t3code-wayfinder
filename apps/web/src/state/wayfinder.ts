import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  ThreadId,
  type WayfinderMapsSnapshot,
  WS_METHODS,
} from "@t3tools/contracts";
import {
  type ClaimantThread,
  type ClaimSessionState,
  claimSessionState,
} from "@t3tools/shared/wayfinderClaim";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentThreadShells } from "./threads";

export const wayfinderSnapshotAtom = createEnvironmentRpcSubscriptionAtomFamily(
  connectionAtomRuntime,
  {
    label: "environment-data:wayfinder:subscribe",
    tag: WS_METHODS.wayfinderSubscribe,
  },
);

function ticketFingerprint(
  snapshot: WayfinderMapsSnapshot | null,
  mapSlug: string,
  number: number,
): string | null {
  const map = snapshot?.maps.find((entry) => entry.slug === mapSlug);
  return map?.tickets.find((ticket) => ticket.number === number)?.fingerprint ?? null;
}

function mapFingerprint(snapshot: WayfinderMapsSnapshot | null, mapSlug: string): string | null {
  return snapshot?.maps.find((entry) => entry.slug === mapSlug)?.fingerprint ?? null;
}

type SnapshotSource = (target: {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly cwd: string };
}) => Atom.Atom<AsyncResult.AsyncResult<{ readonly snapshot: WayfinderMapsSnapshot }, unknown>>;

/**
 * One string atom per document, read from the snapshot stream. It changes only when the file's
 * fingerprint does, so the document query it triggers refetches on a real edit and not on every
 * push. Exported with its source injectable for the staleness test.
 */
export function makeDocumentFingerprintAtoms(source: SnapshotSource) {
  const snapshotOf = (get: Atom.AtomContext, environmentId: EnvironmentId, cwd: string) =>
    AsyncResult.getOrElse(get(source({ environmentId, input: { cwd } })), () => null)?.snapshot ??
    null;
  // Families hash plain objects by reference, so the key is a string.
  const ticketFamily = Atom.family((key: string) => {
    const [environmentId, cwd, mapSlug, number] = JSON.parse(key) as [
      EnvironmentId,
      string,
      string,
      number,
    ];
    return Atom.make((get) =>
      ticketFingerprint(snapshotOf(get, environmentId, cwd), mapSlug, number),
    );
  });
  const mapFamily = Atom.family((key: string) => {
    const [environmentId, cwd, mapSlug] = JSON.parse(key) as [EnvironmentId, string, string];
    return Atom.make((get) => mapFingerprint(snapshotOf(get, environmentId, cwd), mapSlug));
  });
  return {
    ticket: (target: {
      readonly environmentId: EnvironmentId;
      readonly cwd: string;
      readonly mapSlug: string;
      readonly number: number;
    }) =>
      ticketFamily(
        JSON.stringify([target.environmentId, target.cwd, target.mapSlug, target.number]),
      ),
    map: (target: {
      readonly environmentId: EnvironmentId;
      readonly cwd: string;
      readonly mapSlug: string;
    }) => mapFamily(JSON.stringify([target.environmentId, target.cwd, target.mapSlug])),
  };
}

const documentFingerprints = makeDocumentFingerprintAtoms(wayfinderSnapshotAtom);

export const wayfinderTicketDocumentAtom = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "environment-data:wayfinder:read-ticket",
    tag: WS_METHODS.wayfinderReadTicket,
    staleTimeMs: 10 * 60_000,
    refreshTrigger: ({ environmentId, input }) =>
      documentFingerprints.ticket({
        environmentId,
        cwd: input.cwd,
        mapSlug: input.mapSlug,
        number: input.number,
      }),
  },
);

export const wayfinderMapDocumentAtom = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:wayfinder:read-map",
  tag: WS_METHODS.wayfinderReadMap,
  staleTimeMs: 10 * 60_000,
  refreshTrigger: ({ environmentId, input }) =>
    documentFingerprints.map({ environmentId, cwd: input.cwd, mapSlug: input.mapSlug }),
});

export const wayfinderStartTicketThread = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:wayfinder:start-ticket-thread",
  tag: WS_METHODS.wayfinderStartTicketThread,
});

export const wayfinderReleaseClaim = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:wayfinder:release-claim",
  tag: WS_METHODS.wayfinderReleaseClaim,
});

/** Archived threads leave the shell index, so an archived claimant arrives as `null`. */
function claimantFromThreadShell(shell: EnvironmentThreadShell | null): ClaimantThread | null {
  if (shell === null) return null;
  return {
    archived: shell.archivedAt !== null,
    runtimeStatus: shell.runtime?.status ?? null,
    pendingRequest: shell.hasPendingApprovals
      ? "approval"
      : shell.hasPendingUserInput
        ? "input"
        : (shell.pendingSubagentRequest ?? null) === null
          ? null
          : "subagent",
  };
}

/**
 * The claimant's session-state inputs as a JSON string, so shell updates that leave them alone,
 * such as streaming tokens, never re-render the readout.
 */
export const wayfinderClaimantAtom = Atom.family((key: string) => {
  const [environmentId, threadId] = JSON.parse(key) as [EnvironmentId, string | null];
  if (threadId === null) return Atom.make("null");
  const shellAtom = environmentThreadShells.threadShellAtom(
    scopeThreadRef(environmentId, ThreadId.make(threadId)),
  );
  return Atom.make((get) => JSON.stringify(claimantFromThreadShell(get(shellAtom))));
});

/** A claimed ticket's inputs to `claimSessionState`: number, claimant thread id, `claimed_at`. */
export type WayfinderClaimKey = readonly [number, string, string | null];

/**
 * Session state per claimed ticket as a JSON string, read once per claimant shell, so only a
 * state flip re-renders the canvas host. No timer watches the 72 h boundary.
 */
export const wayfinderSessionStatesAtom = Atom.family((key: string) => {
  const [environmentId, claims] = JSON.parse(key) as [EnvironmentId, WayfinderClaimKey[]];
  return Atom.make((get) => {
    const now = Date.now();
    const states: Record<number, ClaimSessionState["state"]> = {};
    for (const [number, threadId, claimedAt] of claims) {
      const shellAtom = environmentThreadShells.threadShellAtom(
        scopeThreadRef(environmentId, ThreadId.make(threadId)),
      );
      states[number] = claimSessionState(
        claimantFromThreadShell(get(shellAtom)),
        claimedAt,
        now,
      ).state;
    }
    return JSON.stringify(states);
  });
});
