// Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr

export type SessionState = "working" | "needs_user" | "unattended";

/** How a session mark is drawn. Shape carries the state; `hue` names a palette field. */
export interface Grammar {
  hue: "claimed" | "blocked";
  orbit: "solid" | "dashed";
  moon: boolean;
  marks: readonly ("trail" | "halo")[];
}

export const GRAMMAR: Record<SessionState, Grammar> = {
  working: { hue: "claimed", orbit: "solid", moon: true, marks: ["trail"] },
  needs_user: { hue: "claimed", orbit: "solid", moon: true, marks: ["halo"] },
  unattended: { hue: "blocked", orbit: "dashed", moon: false, marks: [] },
};

export function nonColorSignature(s: SessionState): string {
  const g = GRAMMAR[s];
  return [`orbit:${g.orbit}`, ...(g.moon ? ["moon"] : []), ...g.marks].join("|");
}
