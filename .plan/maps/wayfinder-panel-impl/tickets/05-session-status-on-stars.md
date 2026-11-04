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
