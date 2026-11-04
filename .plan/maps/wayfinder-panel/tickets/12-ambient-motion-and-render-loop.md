---
type: grilling
blocked_by: [02]
undermined_by: []
assets: []
---

# Ambient motion and a demand-driven render loop

## Question

chartr's star-map runs a continuous requestAnimationFrame loop that drives star drift, the frontier pulse, claimed rings, edge particles, session moons, ticker fade, and camera easing. This repo forbids continuous repaints because they peg the GPU on high-refresh displays. Which of those effects survive, which are replaced by static treatments, and which run only during an interaction such as camera motion, selection, or a snapshot change. Decide the rule for when the loop may run and how it proves it stopped.

## Done when

The answer gives a table of each effect with keep, replace, or drop and its trigger, the invariant the loop must satisfy at rest, and the assertion a seam test can make about it.

## Answer

Nothing moves on its own. The renderer paints on demand and only runs frames while the camera is off its goal or a flare is above zero. Star positions become a pure function of layout.

**Effects**

| Effect                                 | Decision                                                                                                                           | Trigger                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Star drift                             | Drop. Delete `_x/_y`, `#clock`, and the `t` parameter of `#drawStar`. `#drawEdge` and `selectAtScreen` read `x/y`.                 | None                                                                           |
| Frontier pulse                         | Replace with a fixed brighter glow.                                                                                                | None                                                                           |
| Claimed ring                           | Replace with a fixed ring. It draws only when the star has no session state, so it is a fallback once ticket 07 claimants resolve. | None                                                                           |
| Edge particles                         | Drop. Satisfied and unsatisfied edges already differ by colour and solid vs dashed `[4,6]`, and every edge has an arrowhead.       | None                                                                           |
| Session moon                           | Replace with a static glyph.                                                                                                       | One repaint on a session-state change                                          |
| Starfield                              | Keep. Its twinkle is static.                                                                                                       | None                                                                           |
| Flare (1.1 s; click 0.6, about 0.66 s) | Keep.                                                                                                                              | A visual-state change (status or frontier flag, from `visualState`) or a click |
| Ticker                                 | Replace. Hold the line 4.2 s on a timer, then one timeout paints the clear. No fade, no frames.                                    | A visual-state change                                                          |
| Camera ease (0.12 s time constant)     | Keep.                                                                                                                              | The goal moves (`select`, `fit`, wheel, drag, `setInsets`)                     |

The 0.5 s ticker fade was first kept, then dropped on 2026-11-04 with the user's sign-off, because a fade would make the full-canvas repaint run for 4.7 s at 60 to 120 Hz.

**Rest invariant.** At rest no frame is scheduled, no flare is above zero, the camera equals its goal, and at most the ticker's single timer is pending.

**Seam assertion.** After settling, the stubbed `requestAnimationFrame` queue is empty and stays empty after the fake clock passes 4.2 s, and `vi.getTimerCount()` is 0 once the ticker clears.

**Loop rule**

- Every mutator calls `wake()`: `setModel`, `select`, `fit`, `setInsets`, `restoreCamera`, `setBackground`, and the wheel and drag handlers. `wake()` schedules one frame if none is pending, so coalescing is automatic and there is no dirty flag.
- `#render` is the only painter, with one exception: `#onResize` calls `#draw()` unconditionally after `#measure`. `#measure` reassigns canvas width and height, which clears the bitmap even at the same size. chartr returns before drawing when the size is unchanged (starmap.ts around line 683), so the first ResizeObserver callback would leave a blank canvas.
- The loop continues only while the camera is off its goal or any flare is above zero. Drag and gesture are not in the predicate: pan and zoom already move the goal. `onMove` ends a drag when `e.buttons === 0`, so there is no blur handler.
- `wake()` is a no-op without a 2D context. `#render` clears its pending marker first and decides whether to continue in a `finally`, so a throw cannot freeze the map.
- `#last` resets on wake from idle, and dt is `min(dt, 0.1)` in place of chartr's `dt > 0.1 → 0.016`.
- A `setModel` with nothing changed does not wake and does not bump `#labelEpoch`. chartr bumps the epoch unconditionally (line 328) and `structureSignature` ignores titles, types and statuses, so the check compares those, the states and the edges itself.
- Only visual-state changes flare and write a ticker line. A session-state change repaints once with the new glyph. chartr also flares on `sstate` change (line 341); the port drops that on purpose. The first ingest writes no ticker line. A new line replaces the old one and restarts the timer. There is no frame cap on 120 Hz displays, because the effects are bounded and time-based.
- `destroy()` cancels the pending frame and the ticker timer.

**Reduced motion.** The renderer takes `setReducedMotion(boolean)`, fed by `useMediaQuery("(prefers-reduced-motion: reduce)")`, and never reads `matchMedia` itself. The host calls it before the first `setModel`, so the first push never flares. Turning it on mid-flight snaps the camera to its goal and clears flares. Under reduce no animation frames run, and the ticker timer still clears the line.

**Visibility and remount.** The right panel mounts only the active surface (`RightPanelSurfaceContent` switches on one `surface`), so the island unmounts when another tab is showing. It rebuilds from the snapshot and the remembered camera (ticket 10).

- Remount calls `select` first and `restoreCamera` last, so a remembered camera does not ease.
- `select()` never calls `onSelect`. This changes chartr, whose `select()` goes through `#applySelection` and always emits (starmap.ts lines 397-400). Only the click path emits, which removes the wrapper's echo guard. Check chartr tests that expect the emit when porting.
- After a reload with a remembered ticket and no remembered camera, `select` eases once from the fit to the seated star. The user accepted that bounded ease on 2026-11-04 rather than adding a snap option, which amends ticket 10's "centers on the selected star".
- Losing a running flare or ticker on remount is fine.
- The island does not go idle on `visible=false`. The loop already stops when settled, browsers pause `requestAnimationFrame` in hidden documents, and the closing window is short.
- `devicePixelRatio` changes are picked up on the next resize or remount, not live.

**Proof of stop.** One table-driven seam test over the existing harness in starmap.test.ts (lines 398-416, 720-741), which stubs `getContext` and `requestAnimationFrame`. Fake timers use `vi.useFakeTimers({ toFake: ['performance', 'setTimeout'] })`, never `spyOn` on `performance.now` or `Date.now`. Run lint on the ported tests (`no-wall-clock-in-tests`, `no-polling-loop-in-tests`). One row per trigger, each ending with an empty frame queue and zero timers once settled:

- `setModel` with a visual-state change (flare and ticker)
- `setModel` with nothing changed schedules no frame
- `select`, including `select` of the already-selected star, which paints once for the white ring
- drag, and a lost mouse-up (next move with `buttons === 0`)
- `restoreCamera` and `setBackground` paint once without animating
- `setInsets`
- resize, including the first observer callback at the same size, which must leave the canvas painted after the last clear
- resize and `setInsets` in the same frame give one settled paint
- remount with a selected star and a remembered camera ends with nothing animating
- reduced motion on schedules no frames
- `destroy` cancels the frame and the timer

There is no `paintCount()` accessor and no exported `isAnimating()`. There is no "no further draws" assertion, because the ticker timer legitimately paints once. The one-second-flat trace on the real panel is a manual note on ticket 05's prototype, not a permanent test.

**Port notes**

- Delete the drift, orbit and fade tests. Keep the "distinct per state" and "hues ≤ 2" tests.
- `GRAMMAR` and `nonColorSignature` (session.ts line 48, signature `motion|moon|marks`) lose the motion and blink channels, so `implementing` and `blocked` collide until ticket 14 picks shapes. The signature becomes shape plus mark.
- `sessionStates` (terminal-derived) is replaced by thread shells (tickets 07 and 14).

**For ticket 14.** Nothing moves on its own, so every state must be told apart by static shape. chartr says liveness is the moon's motion (`session.ts:7`), and it separates implementing from blocked only by motion (orbit vs crawl) and blink. Ticket 14 must pick static shapes that distinguish running, waiting on the user, idle, archived or stale, and unknown claimant, for example trailing dots vs a hollow or ringed moon.

**Excluded.** Running ambient motion only while the panel is hovered or focused (still a repaint source and a second rule to test). A DOM overlay for the ticker (a second surface for one status line). Keeping the ticker fade as frames. A dirty flag. A `paintCount()` accessor or exported `isAnimating()`. A blur handler. An idle mode on `visible=false`. A frame cap. Live `devicePixelRatio` handling.

Amended by [Star-map island in a right panel tab](./05-starmap-island-prototype.md): selecting a star already on screen does not move the camera, so a reload with a fitted map shows the remembered star without the bounded ease.

Amended by [Session status on stars](./14-session-status-on-stars.md): the single orbit ring every claimed star draws replaces the fixed double claimed ring.

Amended by [Star-map island in a right panel tab](./05-starmap-island-prototype.md): pointer events with `setPointerCapture` and `pointercancel` replace the mouse listeners and the `buttons === 0` lost-mouse-up rule, so the drag row tests `pointercancel` instead; the palette setter replaces `setBackground` in the `restoreCamera` row; `setInsets` and its two rows may be dropped, since the readout never overlays the canvas (ticket 06); a remount with `fitted` remembered calls `fit()` instead of `restoreCamera`.
