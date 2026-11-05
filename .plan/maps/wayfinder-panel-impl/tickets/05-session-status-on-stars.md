---
type: task
blocked_by: [04]
undermined_by: []
assets: []
---

# Session status on stars

## Question

Draw the session-state marks on claimed stars. Every claimed star gets one orbit ring; Working adds a trailed moon, Needs you a haloed moon, and Unattended a dashed muted ring. That covers the two hues, screen-px sizing, the selection ring at core + 15 px, the label obstacle radii, and the canvas summary's per-state clauses. The host passes `Record<number, SessionState>` through `setModel` from the `claimSessionState` ticket 04 built.

Spec sections: [15. Session state](../wayfinder-panel/spec.md#15-session-state) (star marks), [9. Camera, palette, labels, input](../wayfinder-panel/spec.md#9-camera-palette-labels-input) (selection ring and obstacle radii), [17. Accessibility and contrast](../wayfinder-panel/spec.md#17-accessibility-and-contrast), [18. Verification per build ticket](../wayfinder-panel/spec.md#18-verification-per-build-ticket).

## Done when

- A seam test shows that a session-state change marks the model dirty, paints once, raises no flare, and leaves the loop stopped.
- The summary clause test is a row in the existing summary case.
- The PR has captures of each mark in light and dark at panel width with contrast ratios, plus flat-trace rows for a state change (one paint, then zero).
- `vp run check:changed` passes, and the PR body has the "Hit every surface" walk and the docs check.

## Answer

Built on `wayfinder/05-session-status-on-stars` (commit `bc7220761`), branched from the start-and-release branch.

- `#drawSessionMarks` in `starmap.ts` draws every claimed star's orbit ring at core + 6 px with a 1.5 px stroke, then follows `GRAMMAR`: Working adds a 3 px moon at −45° on the ring with two 1.5 px trail dots at 25° and 50° behind it (alpha 0.7 and 0.45, full under `highContrast`); Needs you adds the moon with a 1.5 px halo ring of 5.5 px radius; Unattended draws the ring dashed `[3,3]` in `blocked` with no moon. All sizes divide by the camera scale, so they hold at every zoom. A claimed star with no key wears the solid ring alone. The selection ring and label obstacle radii were already at spec values and are unchanged.
- The host derives states through `wayfinderSessionStatesAtom` in `state/wayfinder.ts`, keyed by environment and the claimed tickets' `[number, claimedBy, claimedAt]`, reading each claimant's shell and returning a JSON string of states, so only a state flip re-renders the island. Until the environment's shells load, the island passes `{}`. The readout's `needs-you` maps to the renderer's `needs_user`.
- `canvasSummary` in `wayfinderCopy.ts` builds the `role="img"` label and appends "n working", "n needs you", "n unattended" for non-zero counts.
- Tests: a stop-table row proves a session-state change paints once with no flare and no ticker line and leaves the loop stopped; an `it.each` over the four grammar rows counts the extra arcs and the dashed orbit through the recording context; `canvasSummary` rows cover the singular, the no-clause, and two clause cases.
- Audit: APPROVE from a haiku subagent. `vp run check:changed` passes on the changed files; its test step also sweeps the leftover prototype worktree at `.claude/worktrees/agent-a3fcfba96cac66b45`, whose stale tests fail. CI does not run on branch pushes in this fork, as with ticket 01.

Excluded: the atom returns the state without the reason, since no mark reads it. Captures in light and dark with contrast ratios and the flat-trace rows are owed to the PR, as on tickets 02 to 04. No new tickets.
