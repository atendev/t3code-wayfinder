// Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr

import type { StarTicket } from "./types";

export type VisualState = "resolved" | "frontier" | "claimed" | "blocked" | "out_of_scope";

export interface StarStyle {
  core: string;
  glow: string;
  r: number;
  gr: number;
}

// Tuned for a warm near-black card (chartr's `--card`); not yet checked against T3 Code tokens.
export const STAR: Record<VisualState, StarStyle> = {
  resolved: { core: "#b9d6c4", glow: "#5b9077", r: 5.4, gr: 24 },
  frontier: { core: "#8ad8ff", glow: "#2f9be0", r: 8.1, gr: 49 },
  claimed: { core: "#ffd873", glow: "#ffb020", r: 7.2, gr: 36 },
  blocked: { core: "#e2c3c3", glow: "#9a6f6f", r: 4.5, gr: 20 },
  out_of_scope: { core: "#948da4", glow: "#6b6478", r: 4.5, gr: 18 },
};

export const LABEL: Record<VisualState, string> = {
  resolved: "#a2c1ac",
  frontier: "#b3e5ff",
  claimed: "#ffe6a0",
  blocked: "#d0b3b3",
  out_of_scope: "#a89fb2",
};

export function visualState(t: Pick<StarTicket, "status" | "frontier">): VisualState {
  switch (t.status) {
    case "resolved":
      return "resolved";
    case "claimed":
      return "claimed";
    case "out_of_scope":
      return "out_of_scope";
    case "open":
      return t.frontier ? "frontier" : "blocked";
  }
}

export const SESSION_HUE = {
  session: "#ffd873",
  gold: "#ffe6a0",
  dead: "#6b7280",
} as const;

export function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
