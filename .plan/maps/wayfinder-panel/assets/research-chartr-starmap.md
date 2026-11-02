# chartr star-map: license and port surface

Research for ticket 02. Source studied: `/home/aten/Documents/Github/chartr` at commit `5aa703ac` (2026-08-19), remote `https://github.com/rengwu/chartr.git`. `web/src/lib/starmap/starmap.ts` last changed in `379e0198` (2026-07-26). Line numbers below are `wc -l` on that checkout.

## 1. Files to port

Svelte-free core (`web/src/lib/starmap/`). None of these import Svelte, Tailwind, xterm, or any npm runtime package.

| File | Lines | Port? | Why |
| --- | --- | --- | --- |
| `starmap/starmap.ts` | 1272 | Yes | The `StarMap` class: canvas renderer, camera, input, labels, ticker, session overlay. |
| `starmap/layout.ts` | 160 | Yes | Pure deterministic layout: `mulberry32`, `rankOf`, `edgesOf`, `computeLayout`, `structureSignature`. |
| `starmap/theme.ts` | 94 | Yes | Five-state palette (`STAR`, `LABEL`), `visualState`, `SESSION_HUE`, `hexA`. |
| `starmap/session.ts` | 82 | Partial | `GRAMMAR`, `SessionState`, `nonColorSignature` are needed by the renderer. `sessionStates(map, terminals)` is chartr-specific (reads `Terminal.session`); replace with a T3 derivation or drop until the session-status decision lands. |
| `starmap/dock.ts` | 78 | Optional | Decides whether the readout docks right or bottom from the card's width and aspect ratio. Only needed if the panel docks the readout the same way. |
| `starmap/starmap.test.ts` | 876 | Yes, adapted | Seam tests: determinism, zero movement, selection, camera, labels, overlay. Vitest + jsdom, no canvas context. |
| `starmap/session.test.ts` | 84 | Partial | Grammar tests port; `sessionStates` tests go with that function. |
| `starmap/dock.test.ts` | 79 | With dock.ts | |
| `starmap/test-setup.ts` | 5 | Yes | Stubs `HTMLCanvasElement.prototype.getContext` to return null under jsdom. |

Core to port: 1608 lines of source (starmap 1272 + layout 160 + theme 94 + session 82) plus 965 lines of tests. With dock: add 78 + 79.

Not ported, but read for the seam contract:

| File | Lines | Role |
| --- | --- | --- |
| `web/src/lib/StarMap.svelte` | 97 | The Svelte wrapper. Shows exactly what a React host must do (section 2). |
| `web/src/lib/mapstate.ts` | 149 | Per-space pane state and camera memory. Chartr's "space" maps to T3's thread/checkout. Only `cameraOf`/`rememberCamera` (an in-memory `Map<string, Camera>`) matter to the island; the slug persistence to localStorage is chrome state. |
| `web/src/lib/model.ts` | 476 | The pushed model. Only `Ticket`, `TicketStatus`, and `Map` are consumed by the core (section 3). |
| `web/src/lib/tokens.ts` | 654 | `readToken`/`resolveColor`/`readColor` (lines 25 to 54) read CSS custom properties off the live document. The island uses it only for `readColor('--card')`. The remaining 600 lines are xterm terminal theming. |
| `web/src/app.css` lines 308 to 322 | 15 | The two CSS rules the renderer relies on: `.starmap-canvas { display: block; touch-action: none; cursor: grab }` and `.starmap-canvas.drag { cursor: grabbing }`. The renderer creates the canvas element itself and toggles `.drag`. |

`starmap-design.md` is referenced in code comments but does not exist in the chartr repo. It belongs to the earlier `wayfinder-maps` renderer chartr cribbed constants from (ADR 0010). It is not available locally; the constants it tuned are already inline in `starmap.ts` and `layout.ts`.

## 2. The seam

ADR 0010 (`docs/adr/0010-svelte-chrome-imperative-islands.md`): the star-map is "one coherent canvas renderer behind a narrow seam (mount, receive model, emit selection), never decomposed into components." The chrome hosts it but never reaches inside; the renderer never reads CSS or app state.

### Exported from `starmap/starmap.ts`

```ts
export type SelectHandler = (num: number | null) => void
export interface Camera { x: number; y: number; s: number }
export function titleBudget(scale: number): number
export function clipTitle(title: string, budget: number): string
export class StarMap {
  mount(host: HTMLElement): void
  setModel(tickets: Ticket[], sessions?: Record<number, SessionState>): void
  onSelect(cb: SelectHandler): void
  select(num: number | null): void
  fit(): void
  setInsets(insets: Partial<{ top: number; right: number; bottom: number; left: number }>): void
  camera(): Camera
  restoreCamera(cam: Camera): void
  setBackground(color: string): void
  destroy(): void
  // test seam
  positions(): Record<number, { x: number; y: number }>
  overlays(): Record<number, SessionState>
  ticker(): string | null
  screenOf(num: number): { x: number; y: number } | null
  selectAtScreen(sx: number, sy: number): number | null
}
```

Guarantees the tests pin (starmap.ts header, lines 5 to 10): layout is deterministic from ticket numbers and `blockedBy` edges only; a `setModel` whose `structureSignature` is unchanged never moves a star, only refreshes appearance and writes a ticker line; layout recomputes and the camera refits only when tickets or edges change.

### Exported from `starmap/layout.ts`

```ts
export const TAU
export interface LayoutNode { num: number; blockedBy?: number[] }
export interface Point { x: number; y: number }
export interface Edge { from: number; to: number }
export function mulberry32(seed: number): () => number
export function rankOf(nodes: LayoutNode[]): Record<number, number>
export function edgesOf(nodes: LayoutNode[]): Edge[]
export function computeLayout(nodes: LayoutNode[]): Record<number, Point>
export function structureSignature(nodes: LayoutNode[]): string
```

`computeLayout` seeds `mulberry32(1337)`, sorts by `num`, places each node on a ring at radius `130 + rank * 165` with jitter, then runs 420 iterations of repulsion (`REP = 9000`), edge springs (`SPRING = 0.02`, `REST = 150`), and radial pull (`RADIAL = 0.05`). Cost is O(420 * N^2) once per structure change, synchronous on the main thread. For maps of tens of tickets this is sub-millisecond; it is not a per-frame cost.

### Exported from `starmap/theme.ts`

```ts
export type VisualState = 'resolved' | 'frontier' | 'claimed' | 'blocked' | 'out_of_scope'
export interface StarStyle { core: string; glow: string; r: number; gr: number }
export const STAR: Record<VisualState, StarStyle>
export const LABEL: Record<VisualState, string>
export function visualState(t: Pick<Ticket, 'status' | 'frontier'>): VisualState
export const SESSION_HUE: { session: '#ffd873'; gold: '#ffe6a0'; dead: '#6b7280' }
export function hexA(hex: string, a: number): string
```

Palette values (hard-coded hex, not tokens):

| State | core | glow | r | gr | label |
| --- | --- | --- | --- | --- | --- |
| resolved | #b9d6c4 | #5b9077 | 5.4 | 24 | #a2c1ac |
| frontier | #8ad8ff | #2f9be0 | 8.1 | 49 | #b3e5ff |
| claimed | #ffd873 | #ffb020 | 7.2 | 36 | #ffe6a0 |
| blocked | #e2c3c3 | #9a6f6f | 4.5 | 20 | #d0b3b3 |
| out_of_scope | #948da4 | #6b6478 | 4.5 | 18 | #a89fb2 |

Other hard-coded colours inside `starmap.ts`: starfield `rgba(255,255,255,1)`, satisfied edge `rgba(160,192,166,0.62)` with arrowhead `#aecdb6`, unsatisfied edge `rgba(132,146,168,0.34)` with arrowhead `#6f7889`, edge particles `rgba(190,225,200,a)`, selection ring `rgba(255,255,255,0.85)`, label shadow `rgba(0,0,0,0.85)`, fallback background `#05070d`. The palette was tuned against a near-black card (`--card` about `#1d1d16`); theme.ts notes `out_of_scope` was lifted to keep roughly 4:1 contrast there. A light-mode T3 theme would need a second palette or a dark surface for the canvas.

### Exported from `starmap/session.ts`

```ts
export type SessionState = 'implementing' | 'blocked' | 'dead'
export interface Grammar { hue: string; motion: 'orbit' | 'crawl' | 'still'; moon: 'orbiting' | 'frozen'; marks: readonly ('trail' | 'blink' | 'halo')[] }
export const GRAMMAR: Record<SessionState, Grammar>
export function nonColorSignature(s: SessionState): string
export function sessionStates(map: WMap, terminals: Terminal[]): Record<number, SessionState>
```

### Exported from `starmap/dock.ts`

```ts
export type Dock = 'right' | 'bottom'
export type DockMethod = 'width' | 'aspect' | 'hybrid'
export const WIDTH_THRESHOLD = 600, ASPECT_RATIO = 1.1, WIDTH_BAND = 32, ASPECT_BAND = 0.12
export function dockByWidth(w), dockByAspect(w, h), dockHybrid(w, h): Dock
export function decideDock(method, w, h, prev: Dock | null, hysteresis: boolean): Dock
```

### What the host does (from `StarMap.svelte`)

1. `new StarMap()`, `onSelect(cb)`, `mount(hostDiv)`.
2. `setBackground(readColor('--card'))` once after mount.
3. `setModel(map.tickets, sessionStates(map, terminals))` on mount and on every model push.
4. `select(selected)` when selection changes from outside.
5. `setInsets(insets)` when the readout pane's measured footprint changes.
6. `fit()` from a recentre button.
7. On unmount: `rememberCamera(key, sm.camera())` then `destroy()`. On the next mount with the same key, `restoreCamera(pose)` after the first fit, seat, and insets.

In React this is one `useEffect` for mount/destroy and one effect per input; each needs a `no-unreasoned-state-sync` reason ("synchronizing with an imperative canvas island").

## 3. Input model shape

The core reads only these fields of `Ticket` (`model.ts` lines 33 to 52):

```ts
export type TicketStatus = 'open' | 'claimed' | 'resolved' | 'out_of_scope'
export interface Ticket {
  num: number          // layout seed and identity
  slug: string         // unused by the renderer
  title: string        // label text
  type: string         // stored on the node, not drawn
  status: TicketStatus // visual state
  blockedBy?: number[] // edges
  frontier: boolean    // splits open into frontier vs blocked
  claimedBy?: string   // unused by the renderer
  claimedAt?: string   // unused by the renderer
  body?: string        // unused by the renderer (readout reads it)
}
```

Renderer dependencies: `num`, `title`, `type`, `status`, `blockedBy`, `frontier`. `Map` (`slug`, `name`, `dir`, `destination`, `body?`, `tickets`, `finished`, `malformations?`) is consumed only by `sessionStates` (for `slug` and `tickets`) and by the chrome.

Chartr's status is derived server-side from the ticket file: resolved when `## Answer` exists, claimed when a claim marker survives, else open, with `frontier` computed from blockers (ADR 0004). The T3 snapshot contract needs to carry the same derived fields; the renderer does no derivation.

The session overlay input is `Record<number, SessionState>`; `sessionStates` derives it from `Terminal.session.mapSlug`, `Terminal.session.ticketNum`, `Terminal.alive`, and `Terminal.status` (`'blocked' | 'dead' | other`). T3 would derive the same three states from the claiming thread's runtime state, if the session-status decision keeps the overlay.

## 4. External dependencies

Runtime imports in the core: none beyond relative files. `starmap.ts` imports `./layout`, `./theme`, `./session`, and `type { Ticket } from '../model'`. `theme.ts` and `session.ts` import `type { Ticket, Map, Terminal } from '../model'` (types only). No npm packages.

Browser globals used: `document.createElement('canvas')`, `canvas.getContext('2d')`, `window.devicePixelRatio`, `window.innerWidth/innerHeight` (fallback when host has no size), `ResizeObserver`, `requestAnimationFrame`/`cancelAnimationFrame`, `performance.now()` (falls back to `Date.now()`), `window.addEventListener('mousemove'|'mouseup')`, canvas events `mousedown`, `wheel` (non-passive), and WebKit's non-standard `gesturestart`/`gesturechange`/`gestureend`. Every listener is removed in `destroy()`. Only mouse events: there is no `pointerdown`/`touchstart`, so touch pan on a touchscreen laptop would not work without adding pointer events.

Chartr concepts the core touches:

- `sessionStates` in `session.ts` reads chartr `Terminal` and `Session`. Everything else in session.ts is renderer vocabulary.
- `mapstate.ts` keys cameras by chartr space id and persists open-map slugs to `localStorage` under `chartr.mappane.v1`. Not needed; the panel can hold `Camera` in its own store keyed by checkout path and map slug.
- `tokens.ts` `readColor('--card')` reads a shadcn-svelte CSS variable. T3's web app also uses shadcn tokens, so the equivalent read is `getComputedStyle(document.documentElement).getPropertyValue('--card')` resolved through a probe element, or a hard-coded dark surface.
- Nothing in the core touches chartr's websocket. The pushed snapshot arrives through the wrapper's props; the renderer only sees `Ticket[]`.
- The two CSS rules in `app.css` (`.starmap-canvas`, `.starmap-canvas.drag`) must be carried; they set `touch-action: none` and the grab cursor.

Test dependencies: `vitest`, `jsdom` environment, the `test-setup.ts` stub. `starmap.test.ts` uses `vi.spyOn`/`vi.useFakeTimers` style helpers for the camera tests (lines 720 to 876) and asserts through `positions()`, `screenOf()`, `camera()`, `overlays()`, `ticker()`. The T3 web test harness runs browser tests through `apps/web/test/render.tsx`; these are not component tests, so a plain `*.test.ts` under jsdom with the same stub fits.

## 5. Animation loop

`starmap.ts` runs a continuous `requestAnimationFrame` loop. `mount()` (line 312) schedules `#render` when a 2D context exists, and `#render` (line 832) reschedules itself unconditionally on every frame until `destroy()` cancels it (line 481). The loop never idles: it runs while the camera is at rest, while nothing is selected, and while the map is unchanged.

Per-frame work that depends on the clock, and so would be lost in an idle-only loop:

- Star drift: each star's render position wobbles plus or minus 2.4 world units on sine curves (`#render`, lines 840 to 843).
- Flare decay after a status change or click (`n.flare`).
- Frontier pulse: glow radius and alpha breathe on `sin(t * 2.8)` (`#drawStar`).
- Claimed rings breathe on the same beat.
- Satisfied edges carry two moving particles each (`#drawEdge`).
- Session moon orbits, crawls, trail, and blink (`#drawSession`).
- Starfield twinkle is seeded per star but static per frame; only its parallax depends on the camera.
- Ticker fade over 4.2 s hold plus 0.5 s fade.
- Camera ease toward the goal with time constant 0.12 s, snapping when within 0.02 px / 0.0005 scale (`#easeCamera`).

Label solving is cached by camera pose, viewport, and model epoch (`#drawLabels`), so it is not per-frame cost, but the full canvas is cleared and repainted every frame regardless.

This violates the target repo's rule (AGENTS.md, Taste: "No continuously repainting animations; they peg the GPU on high-refresh displays"). The port must change the loop to run only while something is in motion: camera not at goal, any `flare > 0`, ticker alpha > 0, a drag or gesture in flight, or a session overlay in `orbit`/`crawl` state if that overlay is kept. Everything else (`#draw` after `setModel`, resize, selection, `restoreCamera`) is a single on-demand paint, which `#onResize` already demonstrates by calling `#draw()` directly. Deciding what happens to the always-on ambient motion (star drift, frontier pulse, claimed rings, edge particles) is a design decision for the spec: drop them, or run them only while the panel is hovered or focused. Dropping drift also simplifies labels, since labels already solve against the settled position precisely to avoid the drift.

The ease uses real elapsed time, not frame count, so a demand-driven loop keeps the feel (test at starmap.test.ts line 789 pins this).

## 6. Attribution

chartr's `LICENSE` is MIT, copyright "2026 John Goh". The MIT condition is that the copyright notice and permission notice be included in all copies or substantial portions. The target repo already handles vendored MIT code two ways (`third-party-licenses.config.json`): a `noticeFile` next to the code (as `apps/web/src/components/files/office/LICENSE.opencode` with a one-line header comment "Adapted from opencode (MIT). Copyright (c) 2025 opencode. See LICENSE.opencode."), or `generatedNotices` with `licenseId` and `copyrights`.

Recommended for the port:

1. Add an entry to `third-party-licenses.config.json`:

```json
{
  "name": "chartr star-map renderer",
  "bundles": ["desktop", "web"],
  "license": "MIT",
  "sourceUrl": "https://github.com/rengwu/chartr/tree/main/web/src/lib/starmap",
  "generatedNotices": [
    { "licenseId": "MIT", "copyrights": ["Copyright (c) 2026 John Goh"] }
  ]
}
```

2. One header line in each ported source file, matching the opencode precedent:

```ts
// Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr
```

3. If a notice file is preferred over generated notices, carry the full text verbatim:

```
MIT License

Copyright (c) 2026 John Goh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Chartr's ADR 0010 states its own renderer was a clean reimplementation with constants cribbed from `wayfinder-maps`. Chartr's LICENSE is the only notice in its tree, so John Goh's notice is the one to carry.

## 7. Port notes for the spec

- The core is already framework-free; a React host is one component with a ref div and the seven calls in section 2.
- Replace `sessionStates` with a T3 derivation or pass `{}` until the session-status ticket decides.
- Replace `readColor('--card')` with T3's token read; the palette assumes a dark surface.
- Convert the rAF loop to demand-driven (section 5). This is the one behavioral change the port must make.
- Add pointer events if touch pan matters on desktop touchscreens; chartr only wired mouse and WebKit gestures.
- `dock.ts` is only needed if the readout docks inside the panel rather than the panel being resizable on its own.
- Code comments in chartr are long and narrative; the target lint `t3code/no-low-value-comments` caps comments at four lines, so most of them go.
