---
type: research
blocked_by: []
undermined_by: []
assets: []
---

# Chartr star-map license and port surface

## Question

chartr at `/home/aten/Documents/Github/chartr` is MIT licensed. Which files under `web/src/lib/starmap/` make up the Svelte-free core, what does its seam look like (mount, receive model, emit selection, camera), what does the model type it consumes contain, which theme tokens it reads, and what in it depends on chartr's websocket or session concepts? What attribution does the MIT license require when the code is ported into this repo?

## Done when

A findings file at `assets/research-chartr-starmap.md` lists the files to port with line counts, the seam's exported functions and types, the input model shape, every external dependency, any continuous animation loop that would violate the no-continuous-repaint rule, and the exact attribution text to carry.
