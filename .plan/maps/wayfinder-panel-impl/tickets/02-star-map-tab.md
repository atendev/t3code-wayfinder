---
type: task
blocked_by: [01]
undermined_by: []
assets: []
---

# Star-map tab

## Question

Show the active checkout's maps as a star-map in a right panel tab. That covers porting chartr's `starmap.ts`, `layout.ts`, `theme.ts`, and `session.ts` (minus `sessionStates`) into `apps/web/src/components/wayfinder/starmap/` with the demand-driven loop and every camera, palette, label, input, and hit-testing change; the `role="img"` summary; the MIT header per file and the `third-party-licenses.config.json` entry; the `Waypoints` tab with its "+" menu, launcher (W), and "Show Wayfinder maps" palette entries; close, `mod+w`, and the `isClosedViewEntry` case for reopen; the nine body states and the problems row; and the picker with per-thread `wayfinder` surface memory, the default-map rule, and read-time stale resolution. Selection writes the memory and draws the selection ring; the readout region holds the map title only until ticket 03. This ticket carries the chartr port, the license entry, and the seam tests.

Spec sections: [7. Renderer port and license](../wayfinder-panel/spec.md#7-renderer-port-and-license), [8. Render loop and motion](../wayfinder-panel/spec.md#8-render-loop-and-motion), [9. Camera, palette, labels, input](../wayfinder-panel/spec.md#9-camera-palette-labels-input), [10. Tab, entry points, and reverses](../wayfinder-panel/spec.md#10-tab-entry-points-and-reverses), [11. Map picker and remembered selection](../wayfinder-panel/spec.md#11-map-picker-and-remembered-selection), [12. Body states and problems row](../wayfinder-panel/spec.md#12-body-states-and-problems-row), [17. Accessibility and contrast](../wayfinder-panel/spec.md#17-accessibility-and-contrast), [18. Verification per build ticket](../wayfinder-panel/spec.md#18-verification-per-build-ticket).

## Done when

- chartr's seam tests are ported and pass, alongside the stop table in spec section 8, and new cases for `fitted` set and clear and the `fit()` remount, label fallback order, nearest-star hit, and pinch about the midpoint.
- Table tests cover default map and stale memory resolution. The closed-view case is added to its existing test.
- The PR has before and after captures at panel width and maximized, light and dark, with measured contrast ratios for each app theme, plus the flat-trace table.
- `vp run check:changed` passes, and the PR body has the "Hit every surface" walk and the docs check.
