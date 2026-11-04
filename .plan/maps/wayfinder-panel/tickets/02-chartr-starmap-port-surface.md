---
type: research
blocked_by: []
undermined_by: []
assets: [assets/research-chartr-starmap.md]
---

# Chartr star-map license and port surface

## Question

chartr at `/home/aten/Documents/Github/chartr` is MIT licensed. Which files under `web/src/lib/starmap/` make up the Svelte-free core, what does its seam look like (mount, receive model, emit selection, camera), what does the model type it consumes contain, which theme tokens it reads, and what in it depends on chartr's websocket or session concepts? What attribution does the MIT license require when the code is ported into this repo?

## Done when

A findings file at `assets/research-chartr-starmap.md` lists the files to port with line counts, the seam's exported functions and types, the input model shape, every external dependency, any continuous animation loop that would violate the no-continuous-repaint rule, and the exact attribution text to carry.

## Answer

Findings: `assets/research-chartr-starmap.md`.

The Svelte-free core is four files under `web/src/lib/starmap/`: `starmap.ts` (1272 lines), `layout.ts` (160), `theme.ts` (94), and `session.ts` (82), with 965 lines of vitest seam tests and a 5-line jsdom canvas stub. `dock.ts` (78) is optional. None import Svelte or any npm package; `model.ts` supplies types only. `StarMap.svelte`, `mapstate.ts`, and `tokens.ts` stay behind; they show what the React host must do.

The seam is the `StarMap` class: `mount(host)`, `setModel(tickets, sessions?)`, `onSelect(cb)`, `select(num)`, `fit()`, `setInsets(insets)`, `camera()`, `restoreCamera(cam)`, `setBackground(color)`, `destroy()`, plus test accessors `positions()`, `overlays()`, `ticker()`, `screenOf()`, `selectAtScreen()`. Exported types are `Camera { x, y, s }` and `SelectHandler`. Two guarantees are pinned by tests: layout is a pure function of ticket numbers and `blockedBy` edges, and a push that keeps the structure never moves a star.

The renderer reads six `Ticket` fields: `num`, `title`, `type`, `status` (`open | claimed | resolved | out_of_scope`), `blockedBy`, and `frontier`. Status and frontier are derived server-side; the renderer derives nothing. Colours are hard-coded hex tuned for a near-black card; the only token read is `--card` for the background, done by the wrapper. Two CSS rules on `.starmap-canvas` (`touch-action: none`, grab cursor) must come along.

Chartr coupling is limited to `sessionStates(map, terminals)` in session.ts, which reads chartr terminal liveness, and `mapstate.ts`, which keys camera memory by chartr space. Nothing touches the websocket. Input is mouse-only plus WebKit gesture events; no pointer or touch events.

The loop is a continuous `requestAnimationFrame` that repaints every frame from mount to destroy, driving star drift, frontier pulse, claimed rings, edge particles, session moons, ticker fade, and the camera ease. That breaks this repo's no-continuous-repaint rule. The port must make it demand-driven: run only while the camera is off goal, a flare or ticker is fading, or a drag is in flight, and paint once on model, resize, and selection changes. Whether the ambient motion survives is a spec decision.

Attribution: MIT, "Copyright (c) 2026 John Goh". Carry it as a `third-party-licenses.config.json` entry with `generatedNotices` (licenseId MIT, that copyright line, sourceUrl `https://github.com/rengwu/chartr`) and a one-line header in each ported file, matching the opencode precedent in `apps/web/src/components/files/office/`. The full license text is in the findings file.

Superseded by ticket 12: the loop runs only while the camera is off its goal or a flare is above zero. A drag in flight and ticker fade are not loop conditions, and the ambient motion is dropped or made static.
