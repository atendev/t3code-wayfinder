// Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr

import { SESSION_HUE } from "./theme";

// chartr's terminal-derived states. Ticket 14 replaces them with thread-shell states.
export type SessionState = "implementing" | "blocked" | "dead";

/** How a session moon is drawn. Everything is static: shape and marks carry the state. */
export interface Grammar {
  hue: string;
  moon: "orbiting" | "frozen";
  marks: readonly ("trail" | "halo")[];
}

// Motion and blink are gone, so `implementing` and `blocked` collide until ticket 14 picks shapes.
export const GRAMMAR: Record<SessionState, Grammar> = {
  implementing: { hue: SESSION_HUE.session, moon: "orbiting", marks: ["trail"] },
  blocked: { hue: SESSION_HUE.session, moon: "orbiting", marks: ["trail"] },
  dead: { hue: SESSION_HUE.dead, moon: "frozen", marks: ["halo"] },
};

export function nonColorSignature(s: SessionState): string {
  const g = GRAMMAR[s];
  return [g.moon, ...g.marks].join("|");
}
