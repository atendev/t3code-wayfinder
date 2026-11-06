import type { EnvironmentId, WayfinderMapsSnapshot } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { makeDocumentFingerprintAtoms, wayfinderClaimantAtom } from "./wayfinder";

const environmentId = "env-1" as EnvironmentId;

function snapshot(ticketFingerprint: string, mapFingerprint = "map-1"): WayfinderMapsSnapshot {
  return {
    cwd: "/repo",
    root: "/repo",
    problems: [],
    maps: [
      {
        slug: "impl",
        title: "Impl",
        fingerprint: mapFingerprint,
        frontier: [1],
        problems: [],
        tickets: [
          {
            number: 1,
            slug: "one",
            title: "One",
            type: "task",
            status: "open",
            frontier: true,
            blockedBy: [],
            underminedBy: [],
            assets: [],
            claimedBy: null,
            claimedAt: null,
            fingerprint: ticketFingerprint,
            problems: [],
          },
        ],
      },
    ],
  };
}

function harness() {
  const source = Atom.make(
    AsyncResult.success({ snapshot: snapshot("t-1") }) as AsyncResult.AsyncResult<
      { readonly snapshot: WayfinderMapsSnapshot },
      unknown
    >,
  ).pipe(Atom.keepAlive);
  const atoms = makeDocumentFingerprintAtoms(() => source);
  const registry = AtomRegistry.make();
  const push = (next: WayfinderMapsSnapshot) =>
    registry.set(source, AsyncResult.success({ snapshot: next }));
  return { atoms, registry, push };
}

describe("document fingerprint atoms", () => {
  it("signals a ticket refetch only when its fingerprint changes", () => {
    const { atoms, registry, push } = harness();
    const trigger = atoms.ticket({ environmentId, cwd: "/repo", mapSlug: "impl", number: 1 });
    const signals: Array<string | null> = [];
    registry.subscribe(trigger, (value) => signals.push(value), { immediate: true });

    push(snapshot("t-1", "map-2"));
    expect(signals).toEqual(["t-1"]);

    push(snapshot("t-2"));
    expect(signals).toEqual(["t-1", "t-2"]);

    push({ ...snapshot("t-2"), maps: [] });
    expect(signals).toEqual(["t-1", "t-2", null]);
    registry.dispose();
  });

  it("signals a map refetch only when the map fingerprint changes", () => {
    const { atoms, registry, push } = harness();
    const trigger = atoms.map({ environmentId, cwd: "/repo", mapSlug: "impl" });
    const signals: Array<string | null> = [];
    registry.subscribe(trigger, (value) => signals.push(value), { immediate: true });

    push(snapshot("t-9"));
    expect(signals).toEqual(["map-1"]);

    push(snapshot("t-9", "map-2"));
    expect(signals).toEqual(["map-1", "map-2"]);
    registry.dispose();
  });
});

describe("wayfinderClaimantAtom", () => {
  it("reads an unclaimed ticket as no claimant", () => {
    const registry = AtomRegistry.make();
    expect(registry.get(wayfinderClaimantAtom(JSON.stringify([environmentId, null])))).toBe("null");
    registry.dispose();
  });
});
