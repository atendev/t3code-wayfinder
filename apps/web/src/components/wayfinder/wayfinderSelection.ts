import type { WayfinderMapSummary } from "@t3tools/contracts";

export function sortMaps(maps: readonly WayfinderMapSummary[]): WayfinderMapSummary[] {
  return [...maps].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** The first map in slug order with a non-empty frontier, otherwise the first map. */
export function defaultMap(maps: readonly WayfinderMapSummary[]): WayfinderMapSummary | null {
  const sorted = sortMaps(maps);
  return sorted.find((map) => map.frontier.length > 0) ?? sorted[0] ?? null;
}

/** Resolves remembered selection against the current snapshot. Never written back. */
export function resolveWayfinderSelection(
  maps: readonly WayfinderMapSummary[],
  memory: { readonly mapSlug?: string | undefined; readonly ticketNumber?: number | undefined },
): { map: WayfinderMapSummary | null; ticketNumber: number | null } {
  const remembered =
    memory.mapSlug === undefined ? undefined : maps.find((map) => map.slug === memory.mapSlug);
  const map = remembered ?? defaultMap(maps);
  const ticketNumber =
    remembered !== undefined &&
    memory.ticketNumber !== undefined &&
    remembered.tickets.some((ticket) => ticket.number === memory.ticketNumber)
      ? memory.ticketNumber
      : null;
  return { map, ticketNumber };
}
