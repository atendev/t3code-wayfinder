import type { WayfinderMapSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { defaultMap, resolveWayfinderSelection } from "./wayfinderSelection";

function map(slug: string, frontier: number[], tickets: number[] = [1, 2]): WayfinderMapSummary {
  return {
    slug,
    title: slug,
    fingerprint: slug,
    frontier,
    problems: [],
    tickets: tickets.map((number) => ({
      number,
      slug: `${number}`,
      title: `${number}`,
      type: "task",
      status: "open",
      frontier: frontier.includes(number),
      blockedBy: [],
      underminedBy: [],
      assets: [],
      claimedBy: null,
      claimedAt: null,
      fingerprint: `${number}`,
      problems: [],
    })),
  };
}

describe("defaultMap", () => {
  it.each([
    { name: "no maps", maps: [], expected: null },
    {
      name: "first by slug with a frontier",
      maps: [map("b", [1]), map("a", []), map("c", [2])],
      expected: "b",
    },
    {
      name: "first by slug when none has a frontier",
      maps: [map("b", []), map("a", [])],
      expected: "a",
    },
  ])("$name", ({ maps, expected }) => {
    expect(defaultMap(maps)?.slug ?? null).toBe(expected);
  });
});

describe("resolveWayfinderSelection", () => {
  const maps = [map("impl", [1]), map("panel", [], [1, 2, 3])];

  it.each([
    { name: "no memory opens the default map", memory: {}, expected: ["impl", null] },
    {
      name: "a remembered map and ticket",
      memory: { mapSlug: "panel", ticketNumber: 3 },
      expected: ["panel", 3],
    },
    {
      name: "a missing map falls back to the default and drops the ticket",
      memory: { mapSlug: "gone", ticketNumber: 1 },
      expected: ["impl", null],
    },
    {
      name: "a missing ticket keeps the map and clears the selection",
      memory: { mapSlug: "panel", ticketNumber: 9 },
      expected: ["panel", null],
    },
    {
      name: "a ticket with no map keeps no selection",
      memory: { ticketNumber: 1 },
      expected: ["impl", null],
    },
  ])("$name", ({ memory, expected }) => {
    const resolved = resolveWayfinderSelection(maps, memory);
    expect([resolved.map?.slug ?? null, resolved.ticketNumber]).toEqual(expected);
  });

  it("resolves nothing when there are no maps", () => {
    expect(resolveWayfinderSelection([], { mapSlug: "panel", ticketNumber: 1 })).toEqual({
      map: null,
      ticketNumber: null,
    });
  });
});
