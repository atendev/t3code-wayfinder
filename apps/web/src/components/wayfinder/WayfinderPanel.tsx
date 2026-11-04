import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTheme } from "../../hooks/useTheme";
import fixture from "./fixture/wayfinder-panel.json";
import { StarMap } from "./starmap/starmap";
import type { StarTicket } from "./starmap/types";

// Prototype: a committed fixture stands in for the WayfinderMaps snapshot (ticket 03).
const tickets = fixture.tickets as StarTicket[];

export function WayfinderPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<StarMap | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { resolvedTheme } = useTheme();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mounts the imperative canvas island
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const map = new StarMap();
    mapRef.current = map;
    map.onSelect(setSelected);
    map.mount(host);
    return () => {
      map.destroy();
      mapRef.current = null;
    };
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- feeds media query into the island before its first model
  useLayoutEffect(() => {
    mapRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the canvas cannot read CSS tokens itself
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    mapRef.current?.setBackground(getComputedStyle(host).backgroundColor);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- re-reads the token when the theme flips
  }, [resolvedTheme]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the snapshot into the island
  useEffect(() => {
    mapRef.current?.setModel(tickets);
  }, []);

  const selectedTicket = tickets.find((ticket) => ticket.num === selected) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="font-medium">{fixture.title}</span>
        <span className="min-w-0 truncate text-muted-foreground">
          {selectedTicket
            ? `#${String(selectedTicket.num).padStart(2, "0")} ${selectedTicket.title}`
            : "Click a star"}
        </span>
      </div>
      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-card [&>canvas]:block [&>canvas]:cursor-grab [&>canvas]:touch-none [&>canvas.drag]:cursor-grabbing"
      />
    </div>
  );
}
