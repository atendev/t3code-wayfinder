---
type: grilling
blocked_by: [03]
undermined_by: []
assets: []
---

# Map picker and remembered selection

## Question

How the user picks among several maps in one checkout, how the picker labels planning maps against `-impl` maps, what the panel remembers across thread switches and reloads (open map, selected ticket, camera), and where that memory lives given the right panel store already persists per-thread surfaces.

## Done when

The answer fixes the picker control, the label rule, the two memory horizons with what each keeps, and the store key.
