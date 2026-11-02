# Wayfinder panel

## Destination

A spec at `./spec.md` that build sessions can take ticket by ticket: a right panel tab in the web and desktop clients that shows every Wayfinder map under the active thread's checkout as a chartr-style star-map, lets the user pick a map when several exist, click a star for the ticket readout, and start a thread on that ticket. Nothing is left to decide before building starts.

## Notes

- Domain: T3 Code web client, server services, contracts. Read `AGENTS.md` first. Server code is Effect; read `docs/internals/effect-services.md` before touching `apps/server`.
- Reference implementation: the chartr repo at `/home/aten/Documents/Github/chartr` (MIT, John Goh). Its format contract is `internal/prompt/assets/conventions.md`; its renderer is `web/src/lib/starmap/`.
- Every session calls the Skill tool for `grilling` and `domain-modeling` unless the ticket says otherwise. Sessions on UI tickets also call `apple` and `impeccable`.
- Standing preferences: smallest model that makes the behavior unsurprising; no continuous repaints; server is authoritative; UI stays dumb.
- Vocabulary for this effort: a **map** is one `map.md` and its tickets under `.plan/maps/<slug>/`; a **ticket** is one question in one file; the **frontier** is the open tickets whose blockers are all resolved; the **star-map** is the canvas rendering of a map; the **readout** is the ticket detail shown on selection; a **claim** is the `claimed_by` field written by the tool, never by an agent.

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
  - Start-thread sends a short prompt naming the map slug and ticket file and invoking `/wayfinder`. No inlined context bundle.
  - Start-thread writes `claimed_by` with the thread id. Clearing it is a required reverse state.
- [Compare the local wayfinder skill with the published one](./tickets/01-compare-wayfinder-skill-with-upstream.md) — local copy is byte-identical to upstream minus two text-only commits; upstream never mentions chartr or `.plan/`; no effect on the file format the panel parses.
- [Chartr star-map license and port surface](./tickets/02-chartr-starmap-port-surface.md) — port four Svelte-free files (about 1,600 lines plus seam tests), no npm dependencies, MIT with a one-line header per file and a third-party-licenses entry; its render loop repaints every frame at rest and must become demand-driven.

## Not yet specified

- **Agent access.** Whether the snapshot is exposed as an MCP tool so agents can see the frontier without reading files, and what that tool returns. Waits on the snapshot contract.
- **Session status on stars.** chartr overlays whether the claiming session is working, idle, or waiting. Whether and how a star shows its claiming thread's runtime state. Waits on the claim design.
- **Spec handoff.** How the finished `spec.md` is cut into an implementation map and whether the panel distinguishes planning maps from `-impl` maps. Waits on the readout and picker decisions.

## Out of scope

- Mobile client. The contract will carry a snapshot a mobile view could consume later, but no mobile UI in this effort.
- GitHub or other remote trackers. Local markdown only.
- Editing tickets, edges, or answers from the panel. Agents and the tracker own writes, except the claim.
