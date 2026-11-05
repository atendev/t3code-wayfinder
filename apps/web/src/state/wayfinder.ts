import {
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, type WayfinderMapsSnapshot, WS_METHODS } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

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
