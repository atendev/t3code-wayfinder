---
type: task
blocked_by: [02]
undermined_by: []
assets: []
---

# Map and ticket readout

## Question

Build the always-present readout. That covers the container-query layout (stacked under 760 px of tab width, a 360 px column above); the map readout with Destination, Notes, Decisions, and the Frontier button list as the non-canvas path; the ticket readout in the spec's order with blocker rows and assets; `readTicket` and `readMap` through atoms keyed by fingerprint; `ChatMarkdown` with the snapshot root and per-file image base; the loading and error states; the back button; and empty-canvas clicks emitting nothing. Start and Release are not built here; the action row is absent.

Spec sections: [13. Readout](../wayfinder-panel/spec.md#13-readout), [17. Accessibility and contrast](../wayfinder-panel/spec.md#17-accessibility-and-contrast), [18. Verification per build ticket](../wayfinder-panel/spec.md#18-verification-per-build-ticket).

## Done when

- Tests cover the fetch staleness rule (a new fingerprint refetches, an equal one does not) and any selection logic added beyond ticket 02. No tests for rendered markup.
- The PR has captures of both layouts and both readouts in light and dark, and flat-trace rows for selecting from a Frontier row and a blocker row (one paint each).
- 02 and 03 merge back to back with no release cut between them, because 02 alone lacks the non-canvas path.
- `vp run check:changed` passes, and the PR body has the "Hit every surface" walk and the docs check.

## Answer

Built as spec section 13 describes, in commit `104118a3d` on `wayfinder/03-map-and-ticket-readout`. `WayfinderReadout.tsx` holds the map readout and the ticket readout; `WayfinderPanel.tsx` lays them out with a container query at 760 px (a 360 px column above, a 45% stacked basis below) and moves focus to the title after a list or blocker selection and to the Frontier heading after back. `apps/web/src/state/wayfinder.ts` reads bodies through `readTicket` and `readMap` query atoms whose refresh trigger is the file's fingerprint from the snapshot stream, so an equal fingerprint keeps the body and a new one refetches with the old body still shown.

Two choices the spec left open: the title renders as an `h2` so it does not outrank the page heading, and the back button uses the 28 px `compact` size because this Button has no `sm`.

Verification: the staleness test covers equal, changed and removed fingerprints for both documents. `vp run check:changed` passes in full. On the dev server both layouts, both readouts, the Frontier and blocker rows, focus moves and the map picker were exercised in light and dark; readout tokens measure 4.83:1 and above on `--card` in light and 7.15:1 and above in dark. Haiku audit approved on round two after a worktree-detection fix.

Not delivered: captures and the two flat-trace rows. The Browser panel ran hidden, so the canvas never painted. The selection path is the renderer's `select()`, whose one-paint row is in the stop table.

Excluded: the action row and claim table (ticket 04).
