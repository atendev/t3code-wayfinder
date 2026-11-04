// Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr

import type { StarTicket } from "./types";

export type VisualState = "resolved" | "frontier" | "claimed" | "blocked" | "out_of_scope";

/** Resolved CSS colours the host reads from theme tokens. The renderer never reads CSS. */
export interface StarPalette {
  background: string;
  frontier: string;
  claimed: string;
  resolved: string;
  blocked: string;
  edge: string;
  edgeMuted: string;
  label: string;
  labelStroke: string;
  scheme: "light" | "dark";
  highContrast: boolean;
}

export const STAR_SIZE: Record<VisualState, { r: number; gr: number }> = {
  resolved: { r: 5.4, gr: 24 },
  frontier: { r: 8.1, gr: 49 },
  claimed: { r: 7.2, gr: 36 },
  blocked: { r: 4.5, gr: 20 },
  out_of_scope: { r: 4.5, gr: 18 },
};

export function starColor(palette: StarPalette, state: VisualState): string {
  switch (state) {
    case "resolved":
      return palette.resolved;
    case "frontier":
      return palette.frontier;
    case "claimed":
      return palette.claimed;
    case "blocked":
    case "out_of_scope":
      return palette.blocked;
  }
}

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
