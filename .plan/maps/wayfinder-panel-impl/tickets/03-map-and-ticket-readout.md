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
