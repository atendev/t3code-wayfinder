# Wayfinder panel spec

This is the settled specification for the Wayfinder tab. Build sessions take it ticket by ticket through the [`wayfinder-panel-impl`](../wayfinder-panel-impl/map.md) map. Each section states the decided behavior and cites the tickets it comes from. Where a ticket was amended, the amended behavior is stated here and the history is left in the ticket. If something a build needs is missing or wrong here, stop and open a ticket on the [`wayfinder-panel`](./map.md) map.

## 1. Scope and vocabulary

Sources: [map](./map.md) charting decisions and Notes, [Session status on stars](./tickets/14-session-status-on-stars.md).

The Wayfinder tab is a right panel tab in the web and desktop clients. It shows every Wayfinder map under the active thread's checkout as a star-map, lets the user pick a map when several exist, shows a readout for the selected star or the map, and starts a thread on a frontier ticket. Agents reach start and release through MCP.

Fixed scope:

- Web and desktop only. Both share the code in `apps/web`.
- The panel reads the local `.plan/maps/` tracker only.
- The file format is chartr's conventions, so chartr, this panel, and the wayfinder skill read the same files. Status is derived, never stored.
- The tab sits beside Diff, Files, and Terminal and is resizable and maximizable through the existing right panel state.
- The view is a canvas star-map ported from chartr's renderer.
- The server parses maps, derives status and frontier, and pushes a typed snapshot over the websocket. Clients never parse files.
- The panel reads the active thread's checkout, worktree or project root.
- The readout has one action, starting a thread on the ticket. Release is its reverse, not a second action.

Vocabulary. Use these words in code, copy, and PRs.

| Term          | Meaning                                                                                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| map           | One `map.md` and its tickets under `.plan/maps/<slug>/`.                                                                                                                                                                   |
| ticket        | One question in one file under a map's `tickets/`.                                                                                                                                                                         |
| frontier      | The open tickets whose blockers all exist and are resolved.                                                                                                                                                                |
| star-map      | The canvas rendering of a map.                                                                                                                                                                                             |
| readout       | The region beside the star-map. It shows the ticket readout when a star is selected and the map readout when none is.                                                                                                      |
| claim         | The `claimed_by` and `claimed_at` frontmatter written by the tool, never by an agent.                                                                                                                                      |
| snapshot      | The server's parsed, metadata-only view of every map in one checkout.                                                                                                                                                      |
| problem       | A parse finding attached to a snapshot, map, or ticket. It never hides a ticket that has a number.                                                                                                                         |
| session state | Working, Needs you, or Unattended. `claimSessionState` in `packages/shared` derives it from the claimant's thread and the claim age, on the client from thread shells and on the server from its projection. Never stored. |

## 2. Already settled outside the build

Sources: [Compare the local wayfinder skill with the published one](./tickets/01-compare-wayfinder-skill-with-upstream.md), [Update the plan template and planning rules](./tickets/08-update-template-and-rules.md), [Pull the upstream wayfinder text changes into the local skill](./tickets/11-sync-local-skill-with-upstream.md), [Agent access to maps through MCP](./tickets/13-agent-access-mcp-tool.md).

These landed already and need no build work:

- The upstream wayfinder skill does not affect the file format. The parser's scope is chartr's `conventions.md` exactly.
- `~/tools/jev-toolbox/plan-init.sh` creates only `.plan/README.md` and `.plan/maps/`. The template README matches this repo's `.plan/README.md`. The global `CLAUDE.md` and the `session-pickup` skill point at `.plan/maps/<slug>/map.md`.
- The local wayfinder skill carries upstream's five text changes and names `.plan/README.md` as the local tracker doc, whose claim rules override the skill's.
- The skill text and `.plan/README.md` do not change for this build.

## 3. File format, status, and frontier

Sources: [map](./map.md) charting decisions, [Map snapshot contract and service shape](./tickets/03-map-snapshot-contract.md).

Layout under the snapshot root:

```
.plan/maps/<slug>/
  map.md              H1 title, then H2 Destination, Notes, Decisions so far, Not yet specified, Out of scope
  tickets/NN-slug.md  one ticket per file
  assets/             files a ticket's `assets` entries name
```

A folder under `.plan/maps/` without a readable `map.md` is not listed as a map. It appears as a snapshot problem.

Ticket frontmatter keys: `type` (`grilling`, `research`, `prototype`, `task`), `blocked_by`, `undermined_by`, `assets`, `claimed_by`, `claimed_at`. Unknown keys and a stored `status` are ignored. The ticket body has an H1 title and H2 sections, `## Question` and `## Done when` first, closed by `## Answer` or `## Ruled out`.

Status, first match wins:

| Condition                                              | Status         |
| ------------------------------------------------------ | -------------- |
| Non-empty `## Answer` (with or without `## Ruled out`) | `resolved`     |
| Non-empty `## Ruled out`                               | `out_of_scope` |
| `claimed_by` was read                                  | `claimed`      |
| Otherwise                                              | `open`         |

A ticket is on the frontier when its status is `open`, every number in `blocked_by` names a ticket in the map, every one of those is `resolved`, and the ticket has no frontmatter problem (`missing-frontmatter`, `invalid-frontmatter`, `invalid-type`). The map's `frontier` lists those numbers by ticket number, ascending.

Parsing is tolerant and per file:

- A ticket with a problem stays a star with the problem attached, so the layout and its dependents' edges do not move while an agent is mid-write.
- A ticket drops out of `tickets` only when it is unreadable, its filename has no number, or its number is a later duplicate. It then appears in the map's `problems`.
- Problems never change status. Status and frontier follow the tables above. A ticket missing `## Done when` can still be on the frontier with its problem shown. The frontmatter-problem rule above is the one exception for frontier.
- Frontmatter keys validate one at a time. A failing key takes its default (`type` is `null`; `blockedBy`, `underminedBy`, and `assets` are empty) and the other keys keep their values. `claimedBy` and `claimedAt` are read as raw strings whenever the block parses.
- A missing H1 falls back to the filename slug for a ticket and the folder slug for a map, so `title` is always a string.
- Numbers parse as integers, so `1` and `01` collide. When two files share a number, the first in filename order owns it. Edges, the frontier, and `readTicket` resolve to that file. Each later file is a `duplicate-number` map problem.
- A `blocked_by` number with no ticket keeps its edge. That ticket is not on the frontier.
- Per-file reads are capped at 1 MiB, as `PROJECT_READ_FILE_MAX_BYTES` is.

## 4. Snapshot contract

Sources: [Map snapshot contract and service shape](./tickets/03-map-snapshot-contract.md), [Watcher and refresh semantics](./tickets/04-watcher-and-refresh.md), amendment from [Ticket readout](./tickets/06-ticket-readout.md).

Schemas live in `packages/contracts/src/wayfinder.ts`, exported from the contracts index.

`WayfinderMapsSnapshot`

| Field      | Shape                   | Notes                                                       |
| ---------- | ----------------------- | ----------------------------------------------------------- |
| `cwd`      | string                  | The subscriber's checkout, echoed.                          |
| `root`     | string                  | The resolved git top-level, or `cwd` when there is none.    |
| `maps`     | `WayfinderMapSummary[]` |                                                             |
| `problems` | `WayfinderProblem[]`    | Snapshot-level, such as a folder with no readable `map.md`. |

`WayfinderMapSummary`

| Field         | Shape                      | Notes                                                   |
| ------------- | -------------------------- | ------------------------------------------------------- |
| `slug`        | string                     | Folder name.                                            |
| `title`       | string                     | H1 of `map.md`, or the slug.                            |
| `fingerprint` | string                     | Hash of the `map.md` bytes. Compared for equality only. |
| `tickets`     | `WayfinderTicketSummary[]` |                                                         |
| `frontier`    | integer[]                  | Ordered ticket numbers.                                 |
| `problems`    | `WayfinderProblem[]`       | Map-level, including dropped ticket files.              |

`WayfinderTicketSummary`

| Field          | Shape                                                       | Notes                                                                                                      |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `number`       | integer                                                     |                                                                                                            |
| `slug`         | string                                                      | Filename slug.                                                                                             |
| `title`        | string                                                      | H1, or the filename slug.                                                                                  |
| `type`         | `"grilling" \| "research" \| "prototype" \| "task" \| null` | `null` when the key is missing or invalid.                                                                 |
| `status`       | `"open" \| "claimed" \| "resolved" \| "out_of_scope"`       | Section 3.                                                                                                 |
| `frontier`     | boolean                                                     | Section 3.                                                                                                 |
| `blockedBy`    | integer[]                                                   |                                                                                                            |
| `underminedBy` | integer[]                                                   |                                                                                                            |
| `assets`       | string[]                                                    | Entries relative to the map's `assets/`.                                                                   |
| `claimedBy`    | string \| null                                              | Raw string, so foreign session ids never fail decoding.                                                    |
| `claimedAt`    | string \| null                                              | Raw string, so bad timestamps never fail decoding.                                                         |
| `fingerprint`  | string                                                      | Hash of the file bytes the parser already read. mtime is not used, because two quick writes can share one. |
| `problems`     | `WayfinderProblem[]`                                        |                                                                                                            |

`WayfinderProblem` is `{ path, reason }`. `path` is relative to `root` with forward slashes, as the server produces it, and clients display it as is. `reason` is a closed set: `unreadable`, `invalid-filename`, `missing-frontmatter`, `invalid-frontmatter`, `invalid-type`, `missing-question`, `missing-done-when`, `both-closing-headings`, `duplicate-number`, and the map-level `missing-title` and `missing-destination`.

The `wayfinder.subscribe` stream's success type is a tagged union with one member, `{ _tag: "snapshot", snapshot }`. Every push carries the whole snapshot. The union stays open so a delta member could be added later without breaking the contract. None is added in this build.

`readTicket` returns `{ fingerprint, title, sections }` and `readMap` returns `{ fingerprint, title, sections }`, where `sections` is `{ heading, markdown }[]`, one entry per H2 section in file order. `heading` is the H2 text and `markdown` is the section body. `fingerprint` matches the summary's fingerprint for the bytes read.

Errors, each keeping the underlying failure (such as `UnknownWorkspaceError`) as `cause`:

- `WayfinderMapsReadError`, the I/O failure. The readout offers Retry for it.
- `WayfinderTicketNotFoundError { mapSlug, number? }`, raised by `readTicket` and `readMap` for an unknown map slug or ticket number. `number` is absent for `readMap`.
- `WayfinderTicketNotStartableError { reason, blockers? }` (section 14)
- `WayfinderClaimLiveError { state, threadId }` (section 14)

No claimant kind or liveness field is in the snapshot. The client resolves `claimedBy` against its thread shells (section 15).

Size. A ticket summary serializes to about 275 bytes unclaimed and 366 bytes claimed with one asset, so a fifty-ticket map is 14 to 18 KB, about 15 KB per map per push. Bodies are fetched on demand because inlining them would add 30 to 175 KB per map.

## 5. `WayfinderMaps` service, root, and RPCs

Sources: [Map snapshot contract and service shape](./tickets/03-map-snapshot-contract.md).

A new `WayfinderMaps` service in `apps/server/src/wayfinder/`, tag `t3/wayfinder/WayfinderMaps`. Read `docs/internals/effect-services.md` first. Parsing, status, and frontier derivation are pure functions beside the service, tested without a filesystem. `KnownWorkspaces` comes from the environment. Every method is a named `Effect.fn("WayfinderMaps.<method>")`.

| Method                                        | Returns                                         |
| --------------------------------------------- | ----------------------------------------------- |
| `getSnapshot(cwd)`                            | The current `WayfinderMapsSnapshot`.            |
| `streamSnapshots(cwd)`                        | A `Stream` of snapshots, the current one first. |
| `readTicket({ cwd, mapSlug, number })`        | The ticket's H2 sections.                       |
| `readMap({ cwd, mapSlug })`                   | `map.md`'s H2 sections.                         |
| `startTicketThread(...)`, `releaseClaim(...)` | Section 14.                                     |

Root. Every call takes `cwd`, the active thread's checkout. Maps are found at the git top-level of `cwd`, falling back to `cwd` itself, so a project rooted in a monorepo subfolder still finds the repository's `.plan/maps/`. A worktree's top-level is the worktree.

Workspace check. `streamSnapshots` runs `KnownWorkspaces.assertContains` once when the subscription starts, not on each push, because the check runs a query and `git worktree list`. `readTicket` and `readMap` check on every call, as `WorkspaceFileSystem.writeFile` does. Writes check before writing (section 14).

Read RPCs. All three go in `RPC_REQUIRED_SCOPES` (`apps/server/src/auth/RpcAuthorization.ts`) under `AuthFilesystemReadScope`, as `projects.readFile` does. None goes in `CLIENT_GUARDED_RPC_SCOPES`. The guarded write RPCs are in section 14.

| RPC                    | Kind   | Payload                    |
| ---------------------- | ------ | -------------------------- |
| `wayfinder.subscribe`  | stream | `{ cwd }`                  |
| `wayfinder.readTicket` | unary  | `{ cwd, mapSlug, number }` |
| `wayfinder.readMap`    | unary  | `{ cwd, mapSlug }`         |

On the client, `wayfinder.subscribe` joins `EnvironmentSubscriptionRpcTag` and uses `createEnvironmentRpcSubscriptionAtomFamily`, as worktree setup does. `readTicket` and `readMap` go through atoms keyed by `cwd`, map slug, ticket number, and fingerprint (section 13).

## 6. Watcher and refresh

Sources: [Watcher and refresh semantics](./tickets/04-watcher-and-refresh.md).

Copy `apps/server/src/environmentTheme.ts:155-216`: `fs.watch` with a trailing debounce, refresh serialized by `Semaphore(1)`, an `Equal.equals` check that skips publishing an unchanged snapshot, a `PubSub.sliding(1)` with a `seq`, and a change stream that emits the current state first. Leave out its `makeDirectory` call. The watcher never creates `.plan/maps`.

Rules:

- One watcher per resolved root, held in a `LayerMap` as `WorkspaceSearchIndexMap` does (`apps/server/src/workspace/WorkspaceSearchIndex.ts:551-559`). Two projects in one monorepo share one watcher.
- Watch `<root>/.plan/maps` recursively. When the folder is missing, watch its parent non-recursively and switch to the folder with `Stream.switchMap` once it appears, as `serverSettings.ts:1243-1268` follows a symlink target.
- Debounce 250 ms trailing, so a step that writes `map.md` and a ticket back to back produces one push.
- Every change publishes the whole snapshot. A push is skipped when the parsed snapshot equals the last published one. The websocket's `perMessageDeflate` with context takeover (`apps/server/src/server.ts:369`) keeps a one-ticket change to a few hundred bytes on the wire.
- Each subscriber's stream maps the shared root snapshot to its own `cwd`.
- The watcher runs while at least one `wayfinder.subscribe` stream is open for its root. Whether the thread is active does not matter. After the last subscriber leaves it stays for a 30 s idle TTL, then stops.
- Mid-write guard. When a refresh would give a ticket a problem it did not have in the last published snapshot, keep that ticket's previous summary and re-read once after 500 ms, then publish whatever the re-read finds. A real problem shows within about 750 ms. The client does nothing special.
- Local, remote, and tunnel connections use the same path. No throttle is built.

## 7. Renderer port and license

Sources: [Chartr star-map license and port surface](./tickets/02-chartr-starmap-port-surface.md), [Star-map island in a right panel tab](./tickets/05-starmap-island-prototype.md) kept-as-ported list, [prototype branch](https://github.com/atendev/t3code-wayfinder/tree/prototype/wayfinder-starmap) at `ed0384dfc`.

Port four Svelte-free files from chartr's `web/src/lib/starmap/` into `apps/web/src/components/wayfinder/starmap/`: `starmap.ts`, `layout.ts`, `theme.ts`, and `session.ts`. Leave out `sessionStates` (terminal-derived), `dock.ts`, `StarMap.svelte`, `mapstate.ts`, and `tokens.ts`. Port chartr's seam tests beside them. The web unit project has no jsdom, so the tests use a small fake DOM, as the prototype does. No npm dependencies are added.

The seam is the `StarMap` class: `mount(host)`, `setModel(tickets, sessions?)`, `onSelect(cb)`, `select(num)`, `fit()`, `camera()`, `restoreCamera(cam)`, `setPalette(palette)` in place of `setBackground` (section 9), `setReducedMotion(boolean)`, `destroy()`, and the test accessors `positions()`, `overlays()`, `ticker()`, `screenOf()`, and `selectAtScreen()`. `setInsets` is dropped, because the readout never overlays the canvas. Exported types are `Camera` (`{ x, y, s }` plus `fitted`, section 9) and `SelectHandler`. The model type is a local six-field `StarTicket`: `num`, `title`, `type`, `status`, `blockedBy`, `frontier`. The renderer derives nothing.

Kept as ported:

- Layout is a pure function of ticket numbers and `blockedBy` edges. A push that keeps the structure never moves a star.
- Flare, camera ease, satisfied edges solid and unsatisfied edges dashed `[4,6]` with arrowheads, star size by state, and the greedy label solver with stars as obstacles and the selected star placed first.
- The starfield, drawn in dark schemes only.
- The `.starmap-canvas` CSS rules: `touch-action: none` and grab cursors.

Host. A lazy `WayfinderPanel.tsx` mounts `StarMap` in `useLayoutEffect`, calls `setReducedMotion` before the first `setModel`, passes the palette (section 9), and writes selection through the right panel store (section 11).

License. chartr is MIT, "Copyright (c) 2026 John Goh".

- Each ported source and test file starts with this line:

  ```ts
  // Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr
  ```

- `third-party-licenses.config.json` gains this entry:

  ```json
  {
    "name": "chartr star-map renderer",
    "bundles": ["desktop", "web"],
    "license": "MIT",
    "sourceUrl": "https://github.com/rengwu/chartr/tree/main/web/src/lib/starmap",
    "generatedNotices": [{ "licenseId": "MIT", "copyrights": ["Copyright (c) 2026 John Goh"] }]
  }
  ```

## 8. Render loop and motion

Sources: [Ambient motion and a demand-driven render loop](./tickets/12-ambient-motion-and-render-loop.md), loop rows and amendments from [Star-map island in a right panel tab](./tickets/05-starmap-island-prototype.md), [Session status on stars](./tickets/14-session-status-on-stars.md).

Nothing moves on its own. The renderer paints on demand and runs frames only while the camera is off its goal or a flare is above zero.

| Effect         | Decision                                                                                                           | Trigger                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Star drift     | Drop. Delete `_x/_y`, `#clock`, and the `t` parameter of `#drawStar`. `#drawEdge` and `selectAtScreen` read `x/y`. | None                                                               |
| Frontier pulse | Replace with a fixed brighter glow.                                                                                | None                                                               |
| Claimed ring   | Replace with the single orbit ring of section 15.                                                                  | None                                                               |
| Edge particles | Drop.                                                                                                              | None                                                               |
| Session moon   | Replace with the static marks of section 15.                                                                       | One repaint on a session-state change                              |
| Starfield      | Keep, static, dark schemes only.                                                                                   | None                                                               |
| Flare          | Keep. 1.1 s; a click flare is 0.6 strength, about 0.66 s.                                                          | A visual-state change (status or frontier flag) or a click         |
| Ticker         | Hold the line 4.2 s on one `setTimeout`, then one paint clears it. No fade, no frames.                             | A visual-state change                                              |
| Camera ease    | Keep, 0.12 s time constant.                                                                                        | The goal moves: `select` (when it pans), `fit`, wheel, drag, pinch |

Loop rules:

- Every mutator calls `#wake()`: `setModel`, `select`, `fit`, `restoreCamera`, `setPalette`, and the wheel, pointer, and gesture handlers. `#wake()` schedules one frame if none is pending, so coalescing needs no dirty flag. It is a no-op without a 2D context.
- `#render` is the only painter, except that `#onResize` calls `#draw()` unconditionally after `#measure`, because `#measure` reassigns canvas width and height and that clears the bitmap even at the same size.
- `#render` clears its pending marker first and decides whether to continue in a `finally`, so a throw cannot freeze the map. It schedules the next frame only while the camera is off its goal or a flare is above zero.
- `#last` resets on wake from idle. `dt` is `min(dt, 0.1)`.
- A `setModel` with nothing changed does not wake and does not bump `#labelEpoch`. The check compares titles, types, statuses, frontier flags, session states, and edges, since `structureSignature` ignores most of those.
- Only visual-state changes flare and write a ticker line. A session-state change repaints once with no flare and no ticker line. The first ingest writes no ticker line. A new line replaces the old one and restarts the timer.
- `select()` never calls `onSelect`. Only the click path emits. Check ported chartr tests that expect the emit.
- `destroy()` cancels the pending frame and the ticker timer.
- No frame cap at 120 Hz.

Rest invariant. At rest no frame is scheduled, no flare is above zero, the camera equals its goal, and at most the ticker's single timer is pending.

Reduced motion. The host feeds `setReducedMotion` from `useMediaQuery("(prefers-reduced-motion: reduce)")`. The renderer never reads `matchMedia`. Turning it on mid-flight snaps the camera to its goal and clears flares. Under reduce no animation frames run, and the ticker timer still clears the line.

Visibility and remount. The right panel mounts only the active surface, so the island unmounts when another tab shows and rebuilds from the snapshot and the in-memory camera (section 11).

- Remount calls `select` first, then `fit()` when the remembered camera has `fitted` set, otherwise `restoreCamera` last, so a remembered camera does not ease.
- Losing a running flare or ticker on remount is fine.
- The island does not idle on `visible=false`.
- `devicePixelRatio` changes are picked up on the next resize or remount.

Proof of stop. One table-driven seam test over the ported harness, which stubs `getContext` and `requestAnimationFrame`. Fake timers use `vi.useFakeTimers({ toFake: ['performance', 'setTimeout'] })`. Each row ends with an empty frame queue, which stays empty after the fake clock passes 4.2 s, and `vi.getTimerCount()` at 0 once the ticker clears. Rows:

- `setModel` with a visual-state change (flare and ticker)
- `setModel` with nothing changed schedules no frame
- `select`, including the already-selected star, which paints once for the ring
- drag, and a drag ended by `pointercancel`
- `restoreCamera` and `setPalette` paint once without animating
- resize, including the first observer callback at the same size, which must leave the canvas painted after the last clear
- remount with a selected star and a remembered camera ends with nothing animating
- remount with `fitted` remembered calls `fit()` and ends with nothing animating
- reduced motion on schedules no frames
- `destroy` cancels the frame and the timer

There is no `paintCount()` accessor, no exported `isAnimating()`, and no "no further draws" assertion. Delete chartr's drift, orbit, and fade tests. Keep "distinct per state" and "hues ≤ 2". Run lint on the ported tests (`no-wall-clock-in-tests`, `no-polling-loop-in-tests`).

## 9. Camera, palette, labels, input

Sources: [Star-map island in a right panel tab](./tickets/05-starmap-island-prototype.md) must-change list, sizing amendment from [Session status on stars](./tickets/14-session-status-on-stars.md), [Map picker and remembered selection](./tickets/10-map-picker-and-memory.md) as amended.

Camera fit mode.

- The renderer keeps one flag, `fitted`. Mount, `fit()`, and a structure-changing `setModel` set it. Wheel, drag, pinch, and `restoreCamera` of a remembered camera clear it.
- While `fitted`, resize and maximize refit and snap, with no ease and one paint. Otherwise resize keeps the current anchor-the-centre behaviour.
- The 0.15 to 1.4 scale clamp stays, so a small map does not balloon when maximized.
- The in-memory camera (section 11) stores `fitted` with the position. It is never persisted.
- When not fitted, the top row shows a Fit button, a `components/ui` `Button` at least 28 px tall, that calls `fit()`. It is hidden while fitted.

Selection seating. `#seat` moves the camera only when the selected star or its label falls outside the canvas rect inset by 16 px. Scale never changes on select. Selecting an on-screen star moves nothing and costs one paint.

Palette.

- Delete the hex tables in `theme.ts`. `setPalette({ background, frontier, claimed, resolved, blocked, edge, edgeMuted, label, labelStroke, scheme: "light" | "dark", highContrast: boolean })` replaces `setBackground` and costs one paint.
- The host fills it from computed tokens and the `prefers-contrast: more` query, and calls it again when the theme or the contrast preference changes. App themes redefine the same tokens, so `useTheme` alone is not enough as the trigger.

  | Field         | Token                                                       |
  | ------------- | ----------------------------------------------------------- |
  | `background`  | `--card`                                                    |
  | `frontier`    | `--info-foreground`                                         |
  | `claimed`     | `--warning-foreground`                                      |
  | `resolved`    | `--success-foreground`                                      |
  | `blocked`     | `--muted-foreground`                                        |
  | `edge`        | `--foreground`                                              |
  | `edgeMuted`   | `--muted-foreground`                                        |
  | `label`       | `--muted-foreground`, or `--foreground` when `highContrast` |
  | `labelStroke` | `--card`                                                    |

- Use: frontier, claimed, and resolved cores in their fields; blocked (open, off the frontier) in `blocked`; out of scope in `blocked` as a hollow ring at the core radius with no filled core; satisfied edges in `edge` and unsatisfied edges in `edgeMuted`, both at reduced alpha. Session marks use `claimed` and `blocked` (section 15).
- The starfield draws only when `scheme` is `"dark"`. Glow alpha comes from `scheme`. `highContrast` draws trail dots at full alpha (section 15).
- Tokens resolve to `oklch()` and `color-mix()` strings, so glows and reduced-alpha strokes set `globalAlpha` instead of appending a hex alpha. The prototype's `hexA` goes.

Labels.

- `system-ui` at 11 to 13 CSS px, never below 11.
- A 3 px text stroke in the `--card` colour, drawn before the fill, replaces the black `shadowBlur`.
- Truncate by measured width. Each label tries the full title, then the title clipped at a word boundary to 180 CSS px, then the number only, and keeps the first that collides with nothing. The number is never dropped.
- A label box stays inside the canvas, shifted sideways if needed.
- Labels hide below scale 0.22, as ported.
- Label obstacle radius: core + 13 px for a claimed star, core + 16 px for the selected star.

Selection ring. Radius core + 15 px with a 1.5 px stroke, so its inner edge sits at least 2 px outside every session mark (section 15).

Input.

- `pointerdown`, `pointermove`, and `pointerup` on the canvas with `setPointerCapture` and `pointercancel` replace chartr's mouse and window listeners.
- Two active pointers pinch-zoom about their midpoint.
- WebKit gesture events stay for the Safari trackpad.
- A click on empty canvas emits nothing, so starting a pan never drops the selection.

Hit testing. Pick the nearest star inside the radius. The radius is at least 14 CSS px for a fine pointer and 22 px for touch or pen.

## 10. Tab, entry points, and reverses

Sources: [map](./map.md) charting decisions, [Entry points and empty state](./tickets/09-entry-points-and-empty-state.md).

Tab. Label "Wayfinder". Icon lucide `Waypoints`, `size-3` in the strip and `size-4` in menus. The surface is the singleton `{ id: "wayfinder", kind: "wayfinder", mapSlug?, ticketNumber? }` (section 11).

Tab layout, top to bottom: the top row (map picker, Fit button), the problems row when there are problems (section 12), then the body. The body is the star-map and the readout (section 13), or one of the states in section 12.

Entry points.

| Entry point                                              | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "+" menu and the empty panel's "Open a surface" launcher | One row, "Wayfinder", letter W, after "Linked pull requests". Launcher description "Browse plan maps and start a thread on a ticket." Available when the active thread has a project (`activeProject !== null`). Otherwise disabled, menu reason "Wayfinder is only available when a project is open.", launcher hint "Available when a project is open." `PullRequestsPage` passes it as unavailable, as it does Files. |
| Command palette                                          | One action, "Show Wayfinder maps", search terms `wayfinder`, `map`, `plan`, `tickets`, `frontier`, listed only when the active thread has a project. Calls `useRightPanelStore.getState().open(threadRef, "wayfinder")`.                                                                                                                                                                                                 |
| Keyboard                                                 | No keybinding. With the panel open, `mod+t` then W. With it closed, `mod+alt+b` first.                                                                                                                                                                                                                                                                                                                                   |
| Settings                                                 | No toggle.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Agents                                                   | No panel entry point. Agents start and release through MCP (section 16).                                                                                                                                                                                                                                                                                                                                                 |

Availability never depends on whether the checkout has maps.

Reverses. The tab closes like every surface: its close button, the tab context menu, and `mod+w`. `mod+shift+t` reopens it with its map and ticket. Add a `wayfinder` case to `isClosedViewEntry` in `apps/web/src/closedViewStore.ts` that checks `id === kind`, an optional string `mapSlug`, and an optional safe-integer `ticketNumber`.

Auto-open. The tab opens on its own only in the new thread after the clicking client starts a ticket thread (section 14). A checkout with maps never opens the tab, and proactive panels never open it.

## 11. Map picker and remembered selection

Sources: [Map picker and remembered selection](./tickets/10-map-picker-and-memory.md), amendments from [Star-map island in a right panel tab](./tickets/05-starmap-island-prototype.md) and [Entry points and empty state](./tickets/09-entry-points-and-empty-state.md).

Picker. The map title in the top row. With two or more maps it is a menu trigger with a chevron, built from an existing `components/ui` menu or select without restyling. With one map it is a plain title with no chevron. Trigger and rows are at least 28 px tall with 6 px between rows. Each row shows the map `title`, then a second line with the `slug` and `{resolved} of {total} resolved`. Rows sort by slug. `-impl` maps get no marking or grouping.

Default map. The first map in slug order with a non-empty frontier, otherwise the first map in slug order.

Memory.

| What                                  | Horizon                              | Where                                                                                         |
| ------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Open map slug, selected ticket number | Survives reload                      | The `wayfinder` surface in the thread's `surfaces`, under `byThreadKey[scopedThreadKey(ref)]` |
| Camera position, scale, and `fitted`  | Survives thread switches, not reload | In memory, keyed by thread key and map slug                                                   |

- A new action `setWayfinderSelection(ref, …)` writes the surface through `automaticUpdate`, as `setPullRequestDetailTab` does, so a click does not bump the user-action revision.
- Writes happen only on a user action (star click, list row, blocker row, picker, back button). `select()` never emits, so restoring a selection never writes.
- Picking a different map clears `ticketNumber`.
- Closing the tab drops the surface. Reopen-closed restores it. A fresh open from the palette starts at the default map.
- `migratePersistedRightPanelState` passes unknown kinds through, so `RIGHT_PANEL_STORAGE_VERSION` does not change.
- After a reload the map starts fitted. A remembered ticket is selected and, being on screen, moves nothing.

Stale memory resolves at read time and is never written back. A missing map slug falls back to the default map. A ticket number missing from the open map keeps the map and clears the selection. Before the first snapshot the tab shows loading and resolves nothing. Lookup uses the slug only, so a thread moved to another worktree keeps its pick when the slug exists there.

Start-thread seed. Section 14.

## 12. Body states and problems row

Sources: [Entry points and empty state](./tickets/09-entry-points-and-empty-state.md).

Every state keeps the top row. Body copy is `text-sm` `text-muted-foreground`. Titles are `text-sm` `text-foreground` medium. Both are centred in the free area like the "Open a surface" launcher. Ellipses are three dots. Buttons are `components/ui` `Button` at least 28 px tall. The first matching state wins.

| #   | Condition                                                        | Shown                                                                                                                                                       | Subscribed |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | The thread has no project                                        | "This thread has no project folder."                                                                                                                        | No         |
| 2   | Read access unknown                                              | Spinner, "Checking file access..."                                                                                                                          | No         |
| 3   | No `AuthFilesystemReadScope`                                     | `fileAccess.error`, falling back to "This connection cannot read host files."                                                                               | No         |
| 4   | Subscribed, no snapshot yet                                      | Spinner, "Loading maps..."                                                                                                                                  | Yes        |
| 5   | Subscription failed                                              | Title "Couldn't read maps", body the error's message, Retry button that resubscribes                                                                        | Failed     |
| 6   | Zero maps, no snapshot problems (missing or empty `.plan/maps/`) | Title "No maps in this checkout", body "Wayfinder reads maps from .plan/maps/ in {root}. Ask an agent to chart one with the wayfinder skill." No button.    | Yes        |
| 7   | Zero maps with snapshot problems                                 | Title "No maps could be read", then the problems list, expanded                                                                                             | Yes        |
| 8   | The open map has no tickets                                      | In place of the canvas, title "This map has no tickets yet", body "Tickets appear as files in .plan/maps/{slug}/tickets/." The picker and the readout stay. | Yes        |
| 9   | Otherwise                                                        | The star-map and the readout                                                                                                                                | Yes        |

`{root}` is the snapshot's `root` with the home directory shown as `~`.

Problems row. Problems never block the canvas while a map has a ticket to draw. When the snapshot's problems, the open map's problems, or any of its tickets' problems are non-empty, one row sits under the top row: "{n} problem" or "{n} problems" with a disclosure chevron, collapsed by default. Expanded, it lists one row per problem: the problem's `path` in mono, then the reason copy. A ticket problem's row is a button that selects that star. Other rows are plain text. The list scrolls inside a 40%-height cap. Expansion is component state.

Reason copy, shared by the problems row and the readout:

| Reason                  | Copy                                              |
| ----------------------- | ------------------------------------------------- |
| `unreadable`            | Can't be read                                     |
| `invalid-filename`      | File name has no ticket number                    |
| `missing-frontmatter`   | No frontmatter                                    |
| `invalid-frontmatter`   | Frontmatter has an invalid value                  |
| `invalid-type`          | Type isn't grilling, research, prototype, or task |
| `missing-question`      | No Question section                               |
| `missing-done-when`     | No Done when section                              |
| `both-closing-headings` | Has both an Answer and a Ruled out section        |
| `duplicate-number`      | Another ticket already uses this number           |
| `missing-title`         | map.md has no title                               |
| `missing-destination`   | map.md has no Destination section                 |

## 13. Readout

Sources: [Ticket readout](./tickets/06-ticket-readout.md).

One readout region is always present in state 8 and state 9. With a ticket selected it shows the ticket readout; with none, the map readout. The region never appears or disappears on selection, so selecting never resizes the canvas. The readout never overlays the canvas.

Placement, by a container query on the tab root, never by the `maximized` flag:

| Tab width        | Layout                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Below 760 px     | Stacked. Canvas on top, `flex-1`, at least 240 px tall. Readout below with a 45% height basis, at least 224 px, its own `ScrollArea`, hairline `border-t`. |
| 760 px and wider | Side by side. Canvas on the left fills the rest. Readout column on the right, 360 px fixed, its own `ScrollArea`, hairline `border-l`.                     |

No draggable splitter. Crossing the threshold resizes the canvas, which refits while `fitted` and paints once.

Ticket readout, in order. Items 1 to 5 and 7 come from the snapshot and render at once. Only item 6 waits on `readTicket`.

1. Header row: a back button ("Map overview", arrow-left icon, `Button` `size="sm"`), the number in tabular numerals, a status `Badge` ("Open" `info`, "Claimed" `warning`, "Resolved" `success`, "Out of scope" `outline`), and a type `Badge` when `type` is not null.
2. Title, the ticket's H1, `text-base` semibold, wrapping, never truncated. A heading with `tabIndex={-1}`.
3. Action row (section 14), with the claimant chip and state line (section 15).
4. Problems, when the summary has any: one warning `Alert` listing each reason's copy (section 12) with its path.
5. Blocked by, then Undermined by: one row per number with number, title, and status. Each row is a button that selects that ticket. A missing number shows the number and "not found".
6. Body sections from `readTicket`, every entry of `sections` in file order with no reordering. Each has a section label (`text-xs`, medium, muted) and markdown below.
7. Assets: each entry as a link to `.plan/maps/<slug>/assets/<entry>`, through the markdown's path-link handling.

Map readout, in order.

1. Progress line, `text-xs` muted, tabular numerals: `{resolved} of {total} resolved · {n} on the frontier`.
2. Checkout line directly under it, `text-xs` muted: "Worktree · {root}" when the active thread is in a worktree (from client thread data), otherwise "Project root · {root}", with the home directory shown as `~`. The ticket readout does not repeat it.
3. Snapshot and map problems, when present: one warning `Alert`.
4. Destination, expanded: the `readMap` section whose heading is Destination.
5. Frontier: one row per number in the map's `frontier`, in order, showing number, title, and type. Each row is a button that selects the ticket. Empty frontier: "Nothing on the frontier."
6. All tickets: a `CollapsibleSectionHeader` (panel variant), collapsed, listing every ticket by number with its status. Rows are buttons that select.
7. Every other `readMap` section (normally Notes, Decisions so far, Not yet specified, Out of scope), in file order: each a collapsed `CollapsibleSectionHeader` labelled with its heading, expanding to its markdown. Expansion lives in component memory.

Selection and focus.

- A star click, a Frontier row, an All tickets row, a blocker row, and a ticket problem row all write the selection through `setWayfinderSelection`. The back button clears `ticketNumber`.
- Selecting from a list or a blocker row moves focus to the ticket title. Selecting on the canvas leaves focus on the canvas. The back button returns focus to the Frontier heading.
- Escape does not deselect.

Markdown. Reuse `ChatMarkdown` as `FileMarkdownPreview` does: `cwd` is the snapshot's `root`; `imageBaseDir` is the folder of the source file (the map's `tickets/` folder or the map folder); `threadRef` is the active thread; `workspaceMutationId` is null; no `onTaskListChange`. One `ChatMarkdown` per section. Relative links open as file links. Links to other tickets are not intercepted.

Loading and errors for `readTicket` and `readMap`.

- Cache in memory keyed by `cwd`, map slug, ticket number, and fingerprint (the map's fingerprint for `readMap`). A push with the same fingerprint does not refetch. A new fingerprint does.
- First load: the snapshot-backed parts render and the body area shows three `Skeleton` lines per expected section. No spinner.
- Refetch after a fingerprint change: the previous body stays until the new one arrives.
- Error: an inline `Alert` in the body area, "Couldn't read this ticket." or "Couldn't read this map.", the error's message below, and a Retry `Button` `size="sm"`. Snapshot-backed parts and the action row stay usable.
- `WayfinderTicketNotFoundError`: "This map is gone." from `readMap`, or "This ticket file is gone." from `readTicket`, with no Retry. The next snapshot drops it and stale-memory resolution falls back (section 11).

Sizes. Every control at least 28 px tall: `Button` `size="sm"` or larger (never `xs`, `micro`, `icon-xs`, or smaller), list rows at least 28 px with 6 px between rows, `CollapsibleSectionHeader` at its 32 px. Coarse pointers keep the button's 44 px hit expansion. Title `text-base`, body at `ChatMarkdown`'s default, labels and metadata `text-xs`. Nothing below 11 px: no `text-3xs` or smaller, and badges use `size="default"`. Padding 16 px horizontal, 8 px vertical steps, 16 px between sections.

## 14. Start thread, claim, and release

Sources: [map](./map.md) charting decisions, [Start a thread from a ticket](./tickets/07-start-thread-action.md) as amended, navigation from [Entry points and empty state](./tickets/09-entry-points-and-empty-state.md), permissions and action row from [Ticket readout](./tickets/06-ticket-readout.md), `force` from [Agent access to maps through MCP](./tickets/13-agent-access-mcp-tool.md), seed from [Map picker and remembered selection](./tickets/10-map-picker-and-memory.md).

Prompt, sent verbatim with a `skill` context record for `wayfinder`:

```
$wayfinder Work ticket {NN} of the {slug} map: .plan/maps/{slug}/tickets/{file}. Load .plan/maps/{slug}/map.md and that ticket only.
```

`$wayfinder` is the provider-neutral skill token (`packages/shared/src/composerInlineTokens.ts`). The Claude adapter rewrites it to `/wayfinder` (`apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts`). Providers without the skill get the same prompt. The thread title is `{NN} {ticket title}` with `generateTitle: false`. `{NN}` is the ticket number zero-padded to at least two digits, `{file}` is the ticket's filename.

Launch settings. No model picker. On the WebSocket path the server resolves the project's effective defaults as a callerless `t3_thread_launch` does (`apps/server/src/mcp/toolkits/project/handlers.ts:170-205`): model selection, runtime mode, interaction mode `default`. The thread runs in the snapshot's `cwd`: the service passes `existing_worktree` with `worktreePath: cwd` when `cwd` differs from the project's workspace root, and `root` otherwise.

`WayfinderMaps.startTicketThread({ cwd, projectId, mapSlug, number, commandId, caller? })`, a named `Effect.fn`, returns `{ threadId, ticketPath }`, where `ticketPath` is the ticket file relative to `root`. `caller` is the optional `{ threadId, modelSelection, runtimeMode, interactionMode, linkOrigin? }` used by MCP (section 16), where `threadId` is the calling thread. With it the service stamps `createdBy: "agent"`, `creationSource: "mcp"`, and `senderThreadId: caller.threadId` as `t3_thread_launch` does, and receives modes already limited by the MCP access layer. Steps:

1. Under a per-root `Semaphore(1)`, run `KnownWorkspaces.assertContains`, then re-read the ticket from disk.
2. Refuse with `WayfinderTicketNotStartableError` unless the ticket is on the frontier and unclaimed (table below).
3. Derive the thread id from `commandId`, as at `handlers.ts:92-100`, so a retry replays instead of creating a second thread.
4. Stamp the claim and write the file with `writeFileStringAtomically` (`packages/shared/src/atomicWrite.ts`).
5. Call `ThreadLaunchService.launch` (`apps/server/src/orchestration-v2/ThreadLaunchService.ts`), the path the WS `launchThread` handler, MCP `t3_thread_launch`, and scheduled tasks share.
6. If `launch` fails before the thread exists, strip the claim. Once the thread is accepted, keep it.

Claim format. `claimed_by` is the raw thread id with no prefix. `claimed_at` is UTC RFC 3339 to the second, for example `2026-11-02T14:03:00Z`. Port chartr's line-based `stampClaim` and `stripClaim` (`internal/server/claim.go`) as pure functions. Claim keys go just before the closing `---`. Other lines keep their order and spelling, so `[03]` stays `[03]`. Restamping is idempotent. No YAML round-trip.

`WayfinderMaps.releaseClaim({ cwd, mapSlug, number, force? })` returns `{ released }`, `false` when the ticket had no claim. Under the same per-root lock it runs `assertContains`, re-reads the ticket, and computes the claimant's session state with `claimSessionState` from the server's projection and the file's `claimed_at` (section 15). Without `force` it refuses with `WayfinderClaimLiveError { state, threadId }` when the state is Working or Needs you, and strips the claim otherwise. With `force: true` it strips the claim.

Clearing the claim.

| Event                                       | Effect                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread deleted                              | `WayfinderClaimReactor` on `streamDomainEvents`, shaped like `PullRequestSyncReactor.ts:676-721`, strips a claim whose `claimed_by` is that thread id, only while the ticket is still open. |
| Release                                     | `releaseClaim` as above.                                                                                                                                                                    |
| Turn ended, thread settled, thread archived | No clear.                                                                                                                                                                                   |
| Claim age                                   | No expiry. Age only affects session state.                                                                                                                                                  |
| Ticket resolved or ruled out                | The claim stays and is inert.                                                                                                                                                               |
| Deletion missed while the server was down   | The claimant resolves as Unattended and the user releases it.                                                                                                                               |

Takeover is two steps, Release then Start.

Refusals. `WayfinderTicketNotStartableError { reason: "missing" | "resolved" | "out-of-scope" | "claimed" | "blocked" | "problem", blockers?: number[] }`, with `blockers` present only for `"blocked"`, listing the unresolved or missing blocker numbers. `WayfinderClaimLiveError { state: "working" | "needs-you", threadId }`. The readout shows its copy as an error toast; the MCP tools put theirs in `message`.

Untyped failures in the readout, such as `WayfinderMapsReadError`, a launch failure, or a transport error, use the same error toast as the typed refusals, with the error's message as its description, and re-enable the button. Start shows "Couldn't start a thread on {NN}." and Release shows "Couldn't release the claim on {NN}."

| Error and reason            | Readout copy                                  | MCP copy                                                                                                                   |
| --------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| NotStartable `missing`      | "This ticket file is gone."                   | "Ticket {NN} of the {slug} map does not exist."                                                                            |
| NotStartable `resolved`     | "This ticket is already resolved."            | "Ticket {NN} is already resolved."                                                                                         |
| NotStartable `out-of-scope` | "This ticket is out of scope."                | "Ticket {NN} is out of scope."                                                                                             |
| NotStartable `claimed`      | "Another thread already claimed this ticket." | "Ticket {NN} is already claimed by thread {claimedBy}."                                                                    |
| NotStartable `blocked`      | "Blocked by 03, 05"                           | "Ticket {NN} is blocked by 03, 05. Resolve those first."                                                                   |
| NotStartable `problem`      | "Fix the frontmatter first"                   | "Ticket {NN} has a frontmatter problem. Fix the file first."                                                               |
| ClaimLive `working`         | "The claiming thread is working now."         | "Ticket {NN}'s claim is held by thread {threadId}, which is working. Pass force: true only if the user asked."             |
| ClaimLive `needs-you`       | "The claiming thread is waiting on you now."  | "Ticket {NN}'s claim is held by thread {threadId}, which is waiting on the user. Pass force: true only if the user asked." |

Blocker numbers in copy are zero-padded like `{NN}`.

RPCs. Both are called through `createEnvironmentRpcCommand`, with UI availability from each command's `permissionAtom`. The server's `RPC_REQUIRED_SCOPES` requires the same scopes as the client table.

| RPC                           | Payload                                          | Scopes                                         |
| ----------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `wayfinder.startTicketThread` | `{ cwd, projectId, mapSlug, number, commandId }` | `orchestration:operate` and `filesystem:write` |
| `wayfinder.releaseClaim`      | `{ cwd, mapSlug, number, force? }`               | `filesystem:write`                             |

In `CLIENT_GUARDED_RPC_SCOPES`, `wayfinder.startTicketThread` lists `orchestration:operate` and `wayfinder.releaseClaim` lists `filesystem:write`. `clientRpcRequiredScopes` in `packages/contracts/src/clientRpcPermissions.ts` gains a special case that adds `filesystem:write` for `wayfinder.startTicketThread`, as it does for `gitPreparePullRequestThread`. Extend the permission behavior tests for both methods.

Action row in the ticket readout. Start is a default-size `Button`, the only primary control in the readout. When Start is disabled the reason is visible text beside or below it, never only a tooltip.

| Ticket state                | Shown                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontier, unclaimed         | Start thread. In flight: disabled with a `Spinner`. A typed refusal shows as a toast with its reason. On success the clicking client navigates (below). |
| Open, not on the frontier   | Start disabled. Reason "Blocked by 03, 05", naming the unresolved blockers.                                                                             |
| Frontmatter problem         | Start disabled. Reason "Fix the frontmatter first". The problem is in the Problems alert.                                                               |
| Claimed, shells not loaded  | Start disabled. No chip, state line, or Release until the environment's shell snapshot arrives.                                                         |
| Claimed                     | Start disabled. Chip, state line, and Release from the claim table (section 15). Start appears once a push shows the claim gone.                        |
| Resolved or out of scope    | No Start and no Release. A leftover claim shows its chip only, as a link to the thread.                                                                 |
| Client lacks the permission | Start disabled with "This connection can't start threads", from the command's `permissionAtom`. Release hidden without `filesystem:write`.              |

Navigation and seed. When the clicking client's `wayfinder.startTicketThread` returns, that client navigates to the new thread and writes the new thread's right panel state once: open, the `wayfinder` surface active, seeded with the map slug and ticket number, not maximized. `proactivePanelsEnabled` does not gate it. Threads started by an agent or another client do not navigate, open, or seed anything.

User docs. Add a new `docs/user/wayfinder.md`, concise, covering where maps live, how to open the tab, what it shows, how to start a ticket, and what an Unattended claim means, and link it from the user guide list in `docs/README.md`.

## 15. Session state

Sources: [Session status on stars](./tickets/14-session-status-on-stars.md), claim table from [Ticket readout](./tickets/06-ticket-readout.md), `force` rule from [Agent access to maps through MCP](./tickets/13-agent-access-mcp-tool.md).

Derivation (built in impl ticket 04). One pure function, `claimSessionState(claimant, claimedAt, now)`, in `packages/shared` as its own subpath export `@t3tools/shared/wayfinderClaim`, tested table-first there.

- `claimant` is `null` or `{ archived, runtimeStatus, pendingRequest }`, where `pendingRequest` is `"approval"`, `"input"`, `"subagent"`, or `null`.
- It returns the state and a reason: Working; Needs you with `approval`, `input` (a `subagent` request also reads as `input`), `turn_ended`, or `failed`; Unattended with `no_thread` or `aged`.
- The active run statuses move from client-runtime's private `threadRunStatusIsActive` into this module, and `threadRuntimeIsActive` imports them.
- It runs only for tickets whose snapshot `status` is `claimed`.
- The client maps its `EnvironmentThreadShell` (`packages/client-runtime/src/state/models.ts`) into the input, resolved with `useThreadShell(scopeThreadRef(environmentId, claimedBy))`. A `null` shell is a `null` claimant. Archived threads leave the client shell index, so an archived claimant arrives as `null`.
- The server's `releaseClaim` maps the claimant from its own projection (archived, runtime status, pending requests) with `claimed_at` from the file it re-read under the lock.

Rules, top to bottom, first match wins:

| State      | Condition                                                                                                                                                                             | Reason                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Unattended | Claimant is `null` (unknown id, archived, deleted while the server was down, another environment), or `archived`                                                                      | `no_thread`                                                  |
| Needs you  | A pending approval, user input, or subagent request (`hasPendingApprovals`, `hasPendingUserInput`, `pendingSubagentRequest !== null`)                                                 | `approval` when an approval is pending, otherwise `input`    |
| Working    | `runtime.status` is `preparing`, `queued`, `starting`, `running`, or `waiting`, including `blockedOnThreadWait`                                                                       | none                                                         |
| Unattended | `claimedAt` parses and is more than 72 h before `now`                                                                                                                                 | `aged`                                                       |
| Needs you  | Anything else: `runtime` is `null`, or `runtime.status` is `idle`, `completed`, `interrupted`, `cancelled`, `rolled_back`, or `failed` (including `lastErrorClass === "usage_limit"`) | `failed` when the status is `failed`, otherwise `turn_ended` |

An unparseable `claimedAt` never makes a claim Unattended by age. `pendingGuestMessageCount` is not read. A pending `auth_refresh` sets neither pending flag, so an active claimant waiting on re-auth reads as Working.

Client reads. The host reads states through a derived atom over `threadShellAtom` that returns only the state and reason per claimant and compares structurally, so streaming tokens never re-render the panel. No timer watches the 72 h boundary. A claim crossing it shows as Unattended on the next snapshot push, shell change, or remount.

Claim table (readout, built in impl ticket 04). The state line sits beside the chip, `text-xs`. This is the only claim copy.

| Session state           | Chip                                                                         | State line                                                                                                                 | Release                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Working                 | `ThreadContextChip` that opens the thread                                    | "Working"                                                                                                                  | Ghost `Button` `size="sm"` with an inline two-click confirm (`useInlineActionConfirm`, moved out of `pullRequest/`). Confirming calls `releaseClaim` with `force: true`. |
| Needs you               | `ThreadContextChip`                                                          | "Needs you: waiting for approval", "Needs you: awaiting input", "Needs you: turn ended", or "Needs you: failed", by reason | Same as Working                                                                                                                                                          |
| Unattended, `no_thread` | `UnresolvedChip` labelled "No open thread", tooltip the raw id and claim age | "Unattended: no open thread holds this claim"                                                                              | Ghost `Button` `size="sm"`, no confirm, no `force`                                                                                                                       |
| Unattended, `aged`      | `ThreadContextChip`                                                          | "Unattended: claimed {n} days ago"                                                                                         | Same as the row above                                                                                                                                                    |

`{n}` is the whole number of days since `claimedAt`. Release in flight is disabled with a `Spinner`, as Start is. If the state flips to Working or Needs you between render and click, the server refuses the unforced Release and the refusal shows as a toast. Other failures follow section 14's untyped-failure rule.

Star marks (built in impl ticket 05). The host passes `Record<number, SessionState>` to `setModel(tickets, sessions)`, with no key for a claimed ticket whose state is unknown because shells have not loaded. All marks are in screen px and keep their size at every zoom, including below the 0.22 label cutoff.

| State                      | Mark                                                  | Non-colour signature       |
| -------------------------- | ----------------------------------------------------- | -------------------------- |
| No key (shells not loaded) | Solid orbit ring in `--warning-foreground`            | `orbit:solid`              |
| Working                    | Solid orbit, filled moon, two trail dots              | `orbit:solid\|moon\|trail` |
| Needs you                  | Solid orbit, filled moon, halo ring around the moon   | `orbit:solid\|moon\|halo`  |
| Unattended                 | Dashed orbit `[3,3]` in `--muted-foreground`, no moon | `orbit:dashed`             |

- Orbit ring: radius core + 6 px, 1.5 px stroke. Every claimed star has one from the first paint.
- Moon: a filled 3 px-radius dot in `claimed` (`--warning-foreground`) centred on the orbit ring at −45° (upper right) on every star.
- Working trail: two 1.5 px-radius dots at 25° and 50° behind the moon, counter-clockwise, at alpha 0.7 and 0.45. Full alpha when `highContrast`.
- Needs you halo: a 1.5 px ring of 5.5 px radius around the moon at full alpha. Its outer edge is at core + 12.25 px, the outermost mark.
- Hues are `--warning-foreground` and `--muted-foreground` only, so "hues ≤ 2" holds. Unattended is a dashed muted ring around the amber claimed core. Out of scope is a hollow muted ring at the core radius, so the two differ in shape.
- `GRAMMAR` becomes `Record<"working" | "needs_user" | "unattended", { hue; orbit: "solid" | "dashed"; moon: boolean; marks: readonly ("trail" | "halo")[] }>`. `nonColorSignature` joins `orbit|moon|marks`, so "distinct per state" passes.
- A session-state change marks the model dirty, wakes once, paints once, and never flares or writes a ticker line.
- The canvas summary adds a clause per non-zero state count (section 17).

## 16. Agent access through MCP

Sources: [Agent access to maps through MCP](./tickets/13-agent-access-mcp-tool.md).

Reads stay on files. No MCP tool exposes `getSnapshot`, `readTicket`, or `readMap`. Agents read `.plan/` with their own file tools.

Two tools in a new `apps/server/src/mcp/toolkits/wayfinder/`, registered in `apps/server/src/mcp/McpHttpServer.ts` with `toolkitRegistration` beside `layerProjectRegistration`. Each handler calls `readCaller()` first, refuses when `caller === undefined` (checkout and project come from the caller's thread), decodes input, calls one `WayfinderMaps` method in the caller's checkout and project, and maps errors to `OrchestratorMcpFailure` with the typed reason in `message`. Neither takes `environmentId` or `cwd`, so linked-environment forwarding never applies.

| Tool                   | Access                                                                                               | Input                                   | Returns                          | Annotations (each `true`)   |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------- | --------------------------- |
| `t3_wayfinder_start`   | `McpToolAccess.startsThreads`, `refused: "start a Wayfinder ticket thread for a linked environment"` | `{ mapSlug, number, clientRequestId? }` | `{ threadId, link, ticketPath }` | `Destructive`, `OpenWorld`  |
| `t3_wayfinder_release` | `McpToolAccess.actsAsCaller`                                                                         | `{ mapSlug, number, force? }`           | `{ released }`                   | `Destructive`, `Idempotent` |

- `startsThreads` requires a read-write client, limits runtime and interaction modes to the caller's, and refuses a linked caller. The handler passes the limited modes as `caller` to `startTicketThread` (section 14), and `createdBy: "agent"` makes `ThreadLaunchService` recheck them under `DispatchModeLimit`.
- `clientRequestId` derives `commandId`, so a retry replays.
- `t3_wayfinder_start` returns the service's `{ threadId, ticketPath }` and adds `link`.
- Refusal `message` text is the MCP copy in section 14's refusal table.
- `t3_wayfinder_release` passes `force` through. The refusal for a Working or Needs you claimant comes from the service, as `t3_project_delete` does it.
- `readCaller()` refuses credentials without the `orchestration` capability, which matches the WebSocket path's scopes.

Starting descriptions. The final wording is whatever passes the evals below.

- `t3_wayfinder_start`: "Start a new thread on one Wayfinder ticket in this thread's checkout and claim the ticket for it. Frontier tickets only: open, unclaimed, every blocker resolved. Not for working a ticket yourself; read its file. After an error or lost reply, retry with the same `clientRequestId`. Mention the thread with its `link`."
- `t3_wayfinder_release`: "Clear a Wayfinder ticket's claim. A claim whose thread is working or waiting on the user needs `force: true`."

Evals. Read `evals/README.md` first. Add `evals/mcp-tool-use/cases/wayfinder.ndjson` with authored Acme data (an `acme/app` checkout and an `onboarding` map). Each case names [ticket 13](./tickets/13-agent-access-mcp-tool.md) as its `source`. Add the toolkit to the explicit toolkit imports in `evals/mcp-tool-use/run.ts`. "Must not write `claimed_by`" is checked with `callsMustNot` entries `{ tool: "Edit", args: { new_string: "~claimed_by" } }` and `{ tool: "Write", args: { content: "~claimed_by" } }`, plus `shellMustNot` matching `claimed_(by|at)`. Record the `--context` size before and after.

| Case                              | Kind    | Prompt and mock                                                                        | Expects                                                                                                                       |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `wayfinder-start-claims`          | guard   | "Start a thread on ticket 05 of the onboarding map."                                   | `t3_wayfinder_start` with `{ mapSlug: "onboarding", number: 5 }`. Not `t3_thread_launch`; no claim write.                     |
| `wayfinder-start-refused-blocked` | guard   | Same ask; the mock returns "blocked by 03".                                            | Reports the blocker. Not `t3_thread_launch`; no frontmatter edit; no other ticket number.                                     |
| `wayfinder-release-stale`         | guard   | "Ticket 07's claim is stale, free it." A variant mock refuses as Working or Needs you. | `t3_wayfinder_release`; no hand edit of `claimed_by`. After the refusal, no retry with `force: true` unless the user said to. |
| `wayfinder-work-own-ticket`       | control | Ticket 07's start prompt: `$wayfinder Work ticket 05 of the onboarding map: …`         | Reads `map.md` and the ticket. Not `t3_wayfinder_start`.                                                                      |
| `wayfinder-frontier-question`     | control | "What's next on the onboarding map?"                                                   | Reads files and answers. Neither tool.                                                                                        |

## 17. Accessibility and contrast

Sources: [Star-map island in a right panel tab](./tickets/05-starmap-island-prototype.md), [Ticket readout](./tickets/06-ticket-readout.md), [Entry points and empty state](./tickets/09-entry-points-and-empty-state.md), [Session status on stars](./tickets/14-session-status-on-stars.md).

Contrast, measured against `--card` in light and dark and under every app theme (`html[data-theme-id]`, `apps/web/src/index.css:1325-1375`):

- Canvas labels at least 4.5:1. Star cores, arrowheads, and session-mark strokes at least 3:1.
- Under `prefers-contrast: more`, every label is `--foreground` (7:1) and trail dots draw at full alpha.
- App themes override `--card`, `--foreground`, `--muted-foreground`, and `--warning-foreground` but not `--info-foreground` or `--success-foreground`. Where a theme misses 4.5:1 or 3:1, add that theme's `--info-foreground` and `--success-foreground` values.
- Readout body and labels at least 4.5:1 using existing tokens. No new colours.
- Measured ratios per theme go in the PR with before and after captures. No test.

Sizes. Controls at least 28 px tall, text never below 11 px (sections 9 and 13).

Screen readers and keyboard.

- The canvas has `role="img"` and a one-line summary, for example "Wayfinder panel, 14 tickets, 3 on the frontier", plus a clause per non-zero session-state count, for example "1 needs you, 1 unattended".
- The island has no arrow-key star navigation. The non-canvas paths are the map readout's Frontier and All tickets lists, blocker rows, and ticket problem rows, all buttons that select.
- Tab order in the body: picker, Fit, problems row, canvas, readout.
- Focus moves as section 13 states.
- Reduced motion as section 8 states. The marks are static, so it changes nothing else.

## 18. Verification per build ticket

Sources: [Spec handoff](./tickets/15-spec-handoff.md), `AGENTS.md` Verifying.

Every build ticket:

- Calls `tdd` for the logic it lists under tests. UI tickets (02, 03, 04, 05) also call `apple` and `impeccable` and run `test-t3-app` once after integrating, using the `Replay (dev)` provider wherever a turn is needed. Ticket 06 reads `evals/README.md` and runs the evals it names.
- Passes `vp run check:changed`.
- Has a written "Hit every surface" walk in the PR body naming which entries applied, and a docs check against the `AGENTS.md` documentation rules.
- Follows the `AGENTS.md` test rules: one layer, extend existing cases, `TestClock` and drained workers, no sleeps, polling, or timeouts.
- Ships as one PR per ticket, stacked and merged in ticket order, once the maintainer confirms the split. If they decline, the six tickets land in order as commits on one branch and one PR, and every Done-when still applies per ticket. Branches are `wayfinder/01-snapshot-service` and so on; 01 branches from `main` and each later one from the previous ticket's branch. Conventional titles; the body ends with the model and harness. Captures go to GitHub, never into the repo.

Flat-trace. Required for any ticket that changes `apps/web/src/components/wayfinder/starmap/` or the host's calls into it (02, 03, 05). Use an uncommitted local paint counter or a DevTools performance recording, and paste the paint table into the PR: mount, idle 3 s and 5 s, click a star, resize, maximize, plus the ticket's own rows. The committed proof is the stop-table test in section 8.

| Ticket | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01     | Parser table tests cover every `WayfinderProblem` reason, duplicate numbers, `1` versus `01`, both closing headings, per-key frontmatter defaults, and frontier `false` on any frontmatter problem. Watcher tests on `TestClock` with the filesystem change signal injected cover debounce merge, skip-unchanged, the 500 ms re-read, and the TTL, plus one `it.live` case that awaits a published snapshot after a real write to a temp dir. The scope table test is extended for the three RPCs. The PR has a short runtime transcript of a subscription receiving a push after a ticket edit. No captures.                                                                                                                                                                                                                                              |
| 02     | chartr's seam tests are ported and pass with the section 8 stop table, plus cases for `fitted` set and clear and the `fit()` remount, label fallback order, nearest-star hit, and pinch about the midpoint. Table tests cover default map and stale memory resolution. The closed-view case is added to its existing test. The PR has before and after captures at panel width and maximized, light and dark, with measured contrast ratios per app theme, and the flat-trace table.                                                                                                                                                                                                                                                                                                                                                                       |
| 03     | Tests cover the fetch staleness rule (a new fingerprint refetches, an equal one does not) and any selection logic added beyond 02. No tests for rendered markup. The PR has captures of both layouts and both readouts in light and dark, and flat-trace rows for selecting from a Frontier row and a blocker row (one paint each). Merge 02 and 03 back to back with no release between them.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 04     | Table tests for stamp and strip (key order, `[03]` kept, idempotent restamp). Service tests for concurrent starts (one claim, one `WayfinderTicketNotStartableError`), launch failure stripping the claim, `commandId` replay, refusal without `force` for a Working or Needs you claimant, and an unforced release of an Unattended one. A reactor test that drains `OrchestrationEffectWorkerV2` after `thread.deleted` and covers the still-open-only rule. Extended permission behavior tests for both methods, including the two-scope start. A table test for `claimSessionState` covering Working, each Needs you reason, and Unattended for missing, archived, and idle over 72 h. Captures of each action-row state and a short video of start through navigation on the Replay provider. `docs/user/wayfinder.md`, linked from `docs/README.md`. |
| 05     | A seam test shows a session-state change marks the model dirty, paints once, raises no flare, and leaves the loop stopped. The summary clause test is a row in the existing summary case. Captures of each mark in light and dark at panel width with contrast ratios, and flat-trace rows for a state change (one paint, then zero).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 06     | Handler tests cover each refusal reason reaching `message`, the callerless refusal, the mode limit reaching `ThreadLaunchService`, and `force` passing through. The five `wayfinder.ndjson` eval cases pass with the toolkit in `run.ts`'s imports. The `--context` sizes before and after go in the PR body. No captures.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 19. Out of scope and exclusions

Sources: [map](./map.md) Out of scope, and every ticket's Excluded list.

From the map:

- Mobile client. The contract will carry a snapshot a mobile view could consume later, but no mobile UI in this effort.
- GitHub or other remote trackers. Local markdown only.
- Editing tickets, edges, or answers from the panel. Agents and the tracker own writes, except the claim.

Excluded by ticket decisions:

- Contract and server ([03](./tickets/03-map-snapshot-contract.md), [04](./tickets/04-watcher-and-refresh.md)): bodies in the snapshot; dropping malformed tickets; a claimant kind or liveness field; delta or per-map events; a turn-end refresh, alone or as a backup; a remote-only throttle; keying watchers by `cwd`.
- Renderer ([05](./tickets/05-starmap-island-prototype.md), [12](./tickets/12-ambient-motion-and-render-loop.md)): ambient motion, including hover-only motion; an eased refit on resize; persisting `fitted`; a light-mode starfield; separate hard-coded palettes; labels on a DOM overlay; edge routing around labels; live `devicePixelRatio` handling; a DOM ticker; a ticker fade; a dirty flag; `paintCount()` or `isAnimating()`; a blur handler; idling on `visible=false`; a frame cap; porting chartr's session glyphs or keyboard handling.
- Readout ([06](./tickets/06-ticket-readout.md)): an overlay or bottom sheet; a readout that appears only on selection; a draggable splitter; switching layout on `maximized`; inlining blockers' answers; intercepting ticket links; persisting section expansion; deselect on empty-canvas click or Escape; refetching `readMap` on every push.
- Start and claims ([07](./tickets/07-start-thread-action.md)): a model picker or carrying the active thread's model; a new worktree per ticket; a client-composed launch with a client claim write; launch-then-claim ordering; clearing on archive, turn end, or age; one-step takeover; disabling Start for providers without the skill.
- Entry points ([09](./tickets/09-entry-points-and-empty-state.md), [10](./tickets/10-map-picker-and-memory.md)): a keybinding; a settings toggle; hiding the entry for checkouts without maps; auto-opening for checkouts with maps or through proactive panels; a "Chart a map" button; separate copy for missing versus empty `.plan/maps/`; a blocking error state for map or ticket problems; persisting the problems row expansion; opening the tab for agent-started or other-client threads; carrying maximized state; the `Sparkles` icon; a segmented picker; a list-first drill-in; `-impl` tagging or grouping; a persisted camera; a separate selection store; per-checkout memory; writing fallbacks back; a "most recently changed" default.
- MCP ([13](./tickets/13-agent-access-mcp-tool.md)): read tools or a trimmed view; a tool that claims for the calling thread; `environmentId` forwarding; callers outside a thread; a `cwd` parameter; skill or `.plan/README.md` changes.
- Session state ([14](./tickets/14-session-status-on-stars.md)): separate marks for idle versus pending, or archived versus unknown; subscribing to the archive query; a failed or usage-limit mark; reading `pendingGuestMessageCount`; treating `auth_refresh` as Needs you; animated marks or a flare on state change; a 72 h timer; per-ticket moon angles; marks scaled with the camera; a third hue.
- Build process ([15](./tickets/15-spec-handoff.md)): one PR for the whole build; layer-by-layer tickets; the renderer port as its own PR; a feature flag; a separate docs ticket; grilling in build sessions; a worktree per build ticket from the panel.
