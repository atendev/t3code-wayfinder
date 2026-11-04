---
type: prototype
blocked_by: [02, 03, 12]
undermined_by: []
assets: []
---

# Star-map island in a right panel tab

## Question

Does chartr's renderer, ported into a React-hosted canvas island and fed the snapshot from ticket 03, feel right inside the resizable and maximized right panel? Build a throwaway tab that mounts the island, draws this map, selects a star on click, and survives resize and maximize without repaint loops. Record what the port needed to change.

## Done when

A prototype branch is linked from `assets/`, with a short capture of the tab at panel width and maximized, and the answer lists the changes the port required and anything that must be redesigned rather than ported.

Note from ticket 12 (the question is unchanged): record a manual flat-trace on the real panel: no frames at idle, after a resize, and after maximize (ticket 12 keeps this out of the permanent tests).
