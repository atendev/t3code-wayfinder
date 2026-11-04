---
type: prototype
blocked_by: [02, 03, 12]
undermined_by: []
assets:
  [
    prototype-starmap/panel-width.png,
    prototype-starmap/panel-width-resized-selected.png,
    prototype-starmap/maximized.png,
    prototype-starmap/BRANCH.md,
  ]
---

# Star-map island in a right panel tab

## Question

Does chartr's renderer, ported into a React-hosted canvas island and fed the snapshot from ticket 03, feel right inside the resizable and maximized right panel? Build a throwaway tab that mounts the island, draws this map, selects a star on click, and survives resize and maximize without repaint loops. Record what the port needed to change.

## Done when

A prototype branch is linked from `assets/`, with a short capture of the tab at panel width and maximized, and the answer lists the changes the port required and anything that must be redesigned rather than ported.

Note from ticket 12 (the question is unchanged): record a manual flat-trace on the real panel: no frames at idle, after a resize, and after maximize (ticket 12 keeps this out of the permanent tests).

## Answer

**Prototype.** Branch [`prototype/wayfinder-starmap`](https://github.com/atendev/t3code-wayfinder/tree/prototype/wayfinder-starmap) at `ed0384dfc`, never merged; `assets/prototype-starmap/BRANCH.md` records the link and head. The tab is under the right panel's "+" menu as Wayfinder (W). It draws a committed fixture of this map, generated from the ticket files by `apps/web/scripts/generate-wayfinder-fixture.ts` as a stand-in for the ticket 03 snapshot. Captures are in `assets/prototype-starmap/`: `panel-width.png` (539 CSS px, dpr 1.75, dark), `panel-width-resized-selected.png` (583 px, 05 selected), and `maximized.png` (944 px).

**Flat-trace** (2026-11-04, on the live panel; a prototype-only counter in `#draw` bumps a DOM attribute):

| Moment                             | Paints                                                |
| ---------------------------------- | ----------------------------------------------------- |
| Mount                              | 2 (the forced resize draw, then the `setModel` frame) |
| Idle, 3 s and 5 s windows          | 0                                                     |
| Click a star                       | 1, then 0                                             |
| Drag the panel edge, 539 to 583 px | 1, then 0 over 4 s                                    |
| Maximize, 583 to 944 px            | 1, then 0 over 4 s                                    |

The Browser panel was hidden during the run, so Chromium throttled `requestAnimationFrame` to about once a second. A loop that never stopped would still paint once a second, so the idle result holds. The click flare and camera ease could not be counted frame by frame; the seam test covers those. `preview_evaluate` runs in an isolated world and CSP blocks inline scripts, which is why the counter lives in the renderer.

**What the port changed from chartr.**

- Deleted: star drift (`_x/_y`, the clock), edge particles, the frontier pulse and claimed-ring beat, moon orbit, crawl, and blink (`motion` and the `blink` mark in `GRAMMAR`), the ticker fade, terminal-derived `sessionStates()`, the always-on loop started in `mount`, and their tests.
- Changed: the loop follows ticket 12 (pending marker cleared first, `dt` clamped to 0.1, next frame scheduled in `finally` only while the camera is off goal or a flare is above zero). Every mutator calls `#wake()`. A `setModel` with no change neither wakes nor bumps `#labelEpoch`. Only visual-state changes flare and write the ticker. `select()` no longer emits. The ticker is one 4.2 s timeout. `#onResize` always draws after `#measure`. A drag ends on `buttons === 0`. `destroy()` clears the timer. Frontier glow, claimed rings, and the moon glyph are static. `Ticket` became a local six-field `StarTicket`.
- Added: `setReducedMotion`, a 13-row table-driven stop test (34 tests pass; breaking the forced resize draw fails the resize row), a small fake DOM in the test because the web unit project has no jsdom, the MIT header per file, and a chartr notice in `third-party-licenses.config.json`.
- Host: a lazy `WayfinderPanel.tsx` mounts `StarMap`, passes the computed `--card` colour to `setBackground` and the reduced-motion query to `setReducedMotion`, keeps selection in component state, and shows the selected title on one line.

**Measured problems.**

- Light theme: the palette is hard-coded for a near-black card, so on the white `--card` only about 4% of pixels differ from the background and the stars wash out.
- Resize and maximize keep the camera's scale. Maximized, the map sits small in an empty field.
- Labels truncate at a fixed length even when maximized, and in the dense cluster around 02, 03, and 04 they cross edges.
- Input is mouse and wheel plus WebKit gesture events. No pointer or touch events.
- `implementing` and `blocked` session glyphs collide (left to the session-status ticket).
- The `toBlob` PNG of the live canvas came out fully transparent although `getImageData` read opaque pixels; captures were re-encoded through `getImageData`. Nothing in the product depends on this.

### Verdict

Decided on 2026-11-04 by a reviewer subagent standing in for the user, at the user's request.

At panel width it mostly works. At 539 px the map reads as a map: the two clusters separate, the three frontier stars stand out first, the size hierarchy holds, and solid and dashed edges are easy to tell apart. The island and the demand-driven loop are accepted.

Maximized, it does not work yet. The panel gains 400 px and the map gets nothing from it. Resizing keeps the old centre at the old scale, so at 583 px star 11 is cut off at the right edge. Labels render at about 9 CSS px, below the 11 pt floor, and in the dense cluster (02, 03, 04, 12) edges run through label text. Light theme is broken. The camera, label, and palette rules below fix all of it.

**Kept as ported**

- The `StarMap` seam, `layout.ts` as a pure function of numbers and edges, and the guarantee that a structure-preserving push never moves a star.
- The ticket 12 loop, including the unconditional `#onResize` draw.
- Flare, camera ease, solid vs dashed `[4,6]` edges with arrowheads, star size by state, and the greedy label solver with stars as obstacles and the selected star first.
- The host pattern: mount in `useLayoutEffect`, `setReducedMotion` before the first `setModel`, `touch-action: none` with grab cursors on the canvas.
- The starfield, in dark schemes only.

**Must change in the build**

- **Camera fit mode.** The renderer keeps one flag, `fitted`. Mount, `fit()`, and a structure-changing `setModel` set it. Wheel, drag, pinch, and a `restoreCamera` of a remembered camera clear it. While `fitted`, resize and maximize refit and snap, with no ease and one paint. Otherwise the current anchor-the-centre behaviour stays. The 0.15–1.4 scale clamp stays, so a small map does not balloon when maximized.
- **`fitted` in the camera memory.** Ticket 10's in-memory camera stores `fitted` with the position. On remount with `fitted` set, the host calls `fit()` instead of `restoreCamera`, so a map left fitted at one panel width refits at the new one. This is not persisting `fitted`: the memory is gone on reload, and a reload starts fitted anyway.
- **Way back to fit.** When not fitted, the tab's top row shows a Fit button from `components/ui`, at least 28 pt tall, that calls `fit()`. It is hidden while fitted. This is the reverse state for panning away.
- **Selection does not pan a visible star.** `#seat` moves the camera only when the selected star or its label falls outside the free rect inset by 16 px. Scale never changes on select. Clicking an on-screen star moves nothing and costs one paint. This amends tickets 10 and 12: after a reload the fitted map already shows the remembered star, so the bounded ease from fit to the seated star no longer happens in that case.
- **Theme-derived palette.** Delete the hex tables in `theme.ts`. The host reads tokens once per theme change (app themes redefine the same tokens, so `useTheme` alone is not enough) and passes them through one palette setter that replaces `setBackground`, costing one paint. Frontier `--info-foreground`, claimed `--warning-foreground`, resolved `--success-foreground`, blocked `--muted-foreground`, out of scope `--muted-foreground` as a hollow ring (shape, not colour alone), satisfied and unsatisfied edges `--foreground` and `--muted-foreground` at reduced alpha. The tokens resolve to `oklch()` and `color-mix()` strings, not hex, so glows and reduced-alpha strokes set `globalAlpha` (per-scheme for glows) rather than appending a hex alpha; the prototype's `hexA` goes.
- **Contrast**, measured against `--card` in light and dark and under every app theme: labels at least 4.5:1, star cores and arrowheads at least 3:1, every label `--foreground` (7:1) under `prefers-contrast: more`. App themes (`html[data-theme-id]`, `apps/web/src/index.css:1325-1375`) override `--card`, `--foreground`, `--muted-foreground`, and `--warning-foreground` but not `--info-foreground` or `--success-foreground`, so the frontier and resolved cores can miss on a themed card. Where an app theme misses 4.5:1 or 3:1, the build adds that theme's `--info-foreground` and `--success-foreground` values. Before/after captures with measured ratios per theme go in the PR; no test.
- **Label legibility.** `system-ui` at 11 to 13 CSS px, never below 11 (the clamp is 8 to 13 today). A 3 px text stroke in the `--card` colour, drawn before the fill, replaces the black `shadowBlur`, so labels read over edges in both schemes.
- **Label fitting.** Truncate by measured width, not by scaled character count. Each label tries, in order, full title, title clipped at a word boundary to 180 CSS px, then number only, and keeps the first that collides with nothing. The number is never dropped. A label box stays inside the canvas, shifted sideways if needed.
- **Pointer events.** `pointerdown`/`pointermove`/`pointerup` on the canvas with `setPointerCapture` and `pointercancel` replace the mouse and window listeners and ticket 12's `buttons === 0` rule. Two active pointers pinch-zoom about their midpoint. WebKit gesture events stay for the Safari trackpad.
- **Hit testing.** Pick the nearest star inside the radius, not the last in node order. The radius is at least 14 CSS px for a fine pointer and 22 px for touch or pen.

**Redesign, do not port**

- Session glyphs. Nothing from chartr's moon grammar ships until Session status on stars picks static shapes.
- Keyboard and screen-reader access. The canvas gets `role="img"` with a one-line summary such as "Wayfinder panel, 14 tickets, 3 on the frontier". Arrow-key star navigation is not built into the island. Ticket readout and Entry points and empty state must give a non-canvas path to frontier tickets.
- The prototype header. The map picker owns the top row; the readout owns what selection shows.

**Excluded.** An eased refit on resize. Persisting `fitted` to the store. A light-mode starfield. Separate hard-coded light and dark palettes. Labels on a DOM overlay. Edge routing around labels. Live `devicePixelRatio` handling.

Amended by [Ticket readout](./06-ticket-readout.md): a click on empty canvas emits no deselect, and the readout never overlays the canvas, so insets stay zero and the build may drop `setInsets` if nothing else uses it.

Amended by [Entry points and empty state](./09-entry-points-and-empty-state.md): the tab icon is `Waypoints`, not the prototype's `Sparkles`.

Amended by [Session status on stars](./14-session-status-on-stars.md): session marks are sized in screen px; the selection ring's inner edge sits at least 2 px outside every session mark (radius core + 15 px); the canvas summary adds a clause per non-zero session-state count.
