# Wayfinder panel

## Destination

A spec at `./spec.md` that build sessions can take ticket by ticket: a right panel tab in the web and desktop clients that shows every Wayfinder map under the active thread's checkout as a chartr-style star-map, lets the user pick a map when several exist, click a star for the ticket readout, and start a thread on that ticket. Nothing is left to decide before building starts.

## Notes

- Domain: T3 Code web client, server services, contracts. Read `AGENTS.md` first. Server code is Effect; read `docs/internals/effect-services.md` before touching `apps/server`.
- Reference implementation: the chartr repo at `/home/aten/Documents/Github/chartr` (MIT, John Goh). Its format contract is `internal/prompt/assets/conventions.md`; its renderer is `web/src/lib/starmap/`.
- Every session calls the Skill tool for `grilling` and `domain-modeling` unless the ticket says otherwise. Sessions on UI tickets also call `apple` and `impeccable`.
- Standing preferences: smallest model that makes the behavior unsurprising; no continuous repaints; server is authoritative; UI stays dumb.
- Vocabulary for this effort: a **map** is one `map.md` and its tickets under `.plan/maps/<slug>/`; a **ticket** is one question in one file; the **frontier** is the open tickets whose blockers are all resolved; the **star-map** is the canvas rendering of a map; the **readout** is the ticket detail shown on selection; a **claim** is the `claimed_by` field written by the tool, never by an agent; a **snapshot** is the server's parsed, metadata-only view of every map in one checkout; a **problem** is a parse finding attached to a snapshot, map, or ticket, which never hides a ticket that has a number.

## Decisions so far

- Charting session (2026-11-02) settled these without tickets:
  - The destination is a spec, not a built feature. Execution is a later implementation map.
  - The panel reads the local `.plan/maps/` tracker only in this effort.
  - Map and ticket files follow chartr's conventions, so chartr, this panel, and the skill share one format. Status is derived, never stored.
  - The panel is a right panel tab beside Diff, Files, and Terminal. Resizable and maximizable through the existing right panel state.
  - Web and desktop only.
  - The view is a canvas star-map ported from chartr's renderer, not an outline and not a graph library.
  - Clicking a star shows the ticket readout; the readout has one action, start a thread on this ticket.
  - A server service parses the maps, derives status and frontier, and pushes a typed snapshot over the websocket. Clients never parse files.
  - The panel reads the active thread's checkout, worktree or project root, and shows which one.
  - Start-thread sends a short prompt naming the map slug and ticket file and invoking the wayfinder skill (token settled in ticket 07). No inlined context bundle.
  - Start-thread writes `claimed_by` with the thread id. Clearing it is a required reverse state.
- [Compare the local wayfinder skill with the published one](./tickets/01-compare-wayfinder-skill-with-upstream.md) — local copy is byte-identical to upstream minus two text-only commits; upstream never mentions chartr or `.plan/`; no effect on the file format the panel parses.
- [Chartr star-map license and port surface](./tickets/02-chartr-starmap-port-surface.md) — port four Svelte-free files (about 1,600 lines plus seam tests), no npm dependencies, MIT with a one-line header per file and a third-party-licenses entry; its render loop repaints every frame at rest and must become demand-driven.
- [Map snapshot contract and service shape](./tickets/03-map-snapshot-contract.md) — new `WayfinderMaps` service keyed by `cwd`, maps found at the git top-level; `wayfinder.subscribe` streams metadata-only snapshots (about 15 KB per fifty-ticket map) with a per-ticket fingerprint, and `readTicket`/`readMap` fetch bodies on demand; all under `AuthFilesystemReadScope`; malformed tickets stay stars with problems attached.
- [Watcher and refresh semantics](./tickets/04-watcher-and-refresh.md) — copy the theme watcher, one per git top-level in a `LayerMap`; 250 ms debounce; whole snapshot per change, skipped when unchanged, no deltas; runs while any subscriber is open, 30 s idle TTL; a newly broken ticket keeps its last good summary for one 500 ms re-read.
- [Start a thread from a ticket](./tickets/07-start-thread-action.md) — `$wayfinder` prompt naming the ticket path; project default model; active checkout; `WayfinderMaps.startTicketThread` claims under a lock then calls `ThreadLaunchService.launch`; claim cleared on thread deletion or manual Release, stale shown after archive or 72 h; unknown claimants shown as another session.
- [Update the plan template and planning rules to chartr conventions](./tickets/08-update-template-and-rules.md) — `plan-init.sh` now creates only `.plan/README.md` and `.plan/maps/`; the template README matches this repo's; the global `CLAUDE.md` points at `.plan/maps/<slug>/map.md`.
- [Map picker and remembered selection](./tickets/10-map-picker-and-memory.md) — title-as-menu picker, hidden for one map; rows show title, slug, and progress with no `-impl` marking; map slug and ticket number persist per thread in a singleton `wayfinder` surface, camera stays in memory; stale memory resolves at read time; start-thread seeds the new thread.
- [Ambient motion and a demand-driven render loop](./tickets/12-ambient-motion-and-render-loop.md) — star drift, edge particles, and moon motion dropped; frontier and claimed treatments made static; a frame loop runs only while the camera is off goal or a flare is above zero, every mutator calls `wake()`; the ticker is a 4.2 s timer with no fade; `select()` never emits; reduced motion snaps; proof is an empty rAF queue and zero timers at rest.
- [Pull the upstream wayfinder text changes into the local skill](./tickets/11-sync-local-skill-with-upstream.md) — the local skill now has upstream's five text changes; research findings go to `assets/`, not research branches; `.plan/README.md` is named as the local tracker doc and its claim rules override the skill's.
- [Agent access to maps through MCP](./tickets/13-agent-access-mcp-tool.md) — reads stay on files, so no read tool; `t3_wayfinder_start` and `t3_wayfinder_release` call `WayfinderMaps` as the calling thread in its checkout, with `t3_thread_launch`'s access and mode limits; ticket 07 gains caller modes and a forced release; five `mcp-tool-use` eval cases, two of them controls; no skill text change.
- [Star-map island in a right panel tab](./tickets/05-starmap-island-prototype.md) — island and demand-driven loop accepted (0 paints idle, 1 per click, resize, and maximize); the build adds a `fitted` camera mode with a Fit button, no pan on selecting a visible star, a token-derived palette with contrast targets, 11 px minimum labels fitted by measured width, pointer events with pinch, and nearest-star hit radii; session glyphs and keyboard access are redesigned, not ported.

## Not yet specified

- **Spec handoff.** How the finished `spec.md` is cut into an implementation map. Waits on the readout decision.

## Out of scope

- Mobile client. The contract will carry a snapshot a mobile view could consume later, but no mobile UI in this effort.
- GitHub or other remote trackers. Local markdown only.
- Editing tickets, edges, or answers from the panel. Agents and the tracker own writes, except the claim.
