---
type: grilling
blocked_by: [05]
undermined_by: []
assets: []
---

# Entry points and empty state

## Question

How the tab is opened: its icon and label in the right panel strip, the command palette entry, the keybinding, and whether a settings toggle hides it. What the tab shows when the checkout has no `.plan/maps/`, when a map has no tickets, and when parsing fails. Whether the tab opens automatically when a thread is started from a ticket.

## Done when

The answer names each entry point and its reverse, the three empty and error states with their copy, and the auto-open rule.

## Answer

Decided on 2026-11-04 by a subagent standing in for the user, at the user's request. It follows the existing right panel surfaces wherever they already answer the question.

**Tab.** Label "Wayfinder", fixed; the map picker in the top row carries the map title (ticket 10). Icon lucide `Waypoints` at the size other tab icons use (`size-3` in the strip, `size-4` in menus). The prototype's `Sparkles` reads as an AI feature and is dropped. The surface is the singleton `{ id: "wayfinder", kind: "wayfinder", mapSlug?, ticketNumber? }` from ticket 10.

**Entry points.**

- "+" menu and the empty panel's "Open a surface" launcher: one row, "Wayfinder", letter **W** (free; the others are B, T, F, D, P, L, M, S). It sits after "Linked pull requests". The launcher row's description is "Browse plan maps and start a thread on a ticket." Availability matches Files: available when the active thread has a project (`activeProject !== null`), otherwise disabled with the menu reason "Wayfinder is only available when a project is open." and the launcher hint "Available when a project is open." `PullRequestsPage` passes it as unavailable, as it does Files. Availability never depends on whether the checkout has maps: knowing that would need a subscription, and so a watcher, for every open thread.
- Command palette: one action, "Show Wayfinder maps", search terms `wayfinder`, `map`, `plan`, `tickets`, `frontier`, listed only when the active thread has a project. It calls `useRightPanelStore.getState().open(threadRef, "wayfinder")`, as "Show linked pull requests" does, so it opens the panel or focuses the existing tab.
- Keybinding: none, and no new keybinding command. Files, Device, and the pull request surfaces have none either. With the panel open, `mod+t` (`rightPanel.new`) then **W** is the keyboard path. `mod+t` is bound with `when: "rightPanelOpen && !terminalFocus"` (`packages/shared/src/keybindings.ts:159`), so with the panel closed the path starts with `mod+alt+b` (`rightPanel.toggle`, line 157).
- Settings toggle: none. No surface has a visibility toggle; `enableDeviceSupport` gates device hosts, not the Device row.
- Agents: no entry point. Ticket 13 left reads on files, and opening a client panel is not an agent capability.

**Reverses.** The tab closes like every surface: its close button, the tab context menu, and `mod+w` (`rightPanel.close`). `mod+shift+t` (`view.reopenClosed`) brings it back with its map and ticket (ticket 10). The build adds a `wayfinder` case to `isClosedViewEntry` in `closedViewStore.ts` that checks `id === kind`, an optional string `mapSlug`, and an optional safe-integer `ticketNumber`; without it, a closed Wayfinder tab is dropped on reload.

**States, in the tab body, in this order of precedence.** Every state keeps the tab's top row. Body copy is `text-sm` (14 px) `text-muted-foreground`, as Files' loading line; titles are `text-sm` `text-foreground` medium, as the "Open a surface" launcher's title. Both are centred in the free area like that launcher. Ellipses are three dots, as in `apps/web/src/components/files/FilePreviewPanel.tsx:1236`. Buttons are `components/ui` `Button` at a size of at least 28 px tall.

1. No project on the thread (the tab survives from earlier, or the project was removed): "This thread has no project folder." No subscription.
2. Read access unknown: a spinner and "Checking file access...", as Files shows. No subscription yet.
3. No `AuthFilesystemReadScope`: `fileAccess.error`, falling back to "This connection cannot read host files.", the Files copy. No subscription, since every Wayfinder RPC needs the scope (ticket 03).
4. Subscribed, no snapshot yet: a spinner and "Loading maps...". Nothing resolves from memory (ticket 10).
5. Subscription failed (`WayfinderMapsReadError`, an unknown workspace, a dropped connection that the subscription atom does not recover): title "Couldn't read maps", body the error's message, and a Retry button that resubscribes.
6. Snapshot with zero maps and no snapshot problems, which covers a missing `.plan/maps/` and an empty one (the snapshot cannot tell them apart and the user does not need it to): title "No maps in this checkout", body "Wayfinder reads maps from .plan/maps/ in {root}. Ask an agent to chart one with the wayfinder skill." `{root}` is the snapshot's `root`, shown with the home directory as `~`, so a worktree and the project root are told apart. No action button.
7. Snapshot with zero maps and snapshot problems: title "No maps could be read", then the problems list described below, expanded.
8. A map with no tickets: the canvas is replaced by title "This map has no tickets yet" and body "Tickets appear as files in .plan/maps/{slug}/tickets/." The picker and the map's own material through the readout (ticket 06) stay.
9. Otherwise the star-map.

**Problems.** Problems never block the canvas while a map has a ticket to draw. When the snapshot's problems, the open map's problems, or any of its tickets' problems are non-empty, a single row sits under the top row: "{n} problem" or "{n} problems", with a disclosure chevron. It starts collapsed and stays a single row, so the canvas does not jump when an agent breaks and fixes a file. Expanded, it lists one row per problem: the path relative to `root` in mono, then the reason. A ticket problem's row is a button that selects that star; other rows are plain text. The list scrolls inside a 40%-height cap. Collapsed or expanded is component state, not stored. Reason copy, which the readout reuses:

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

**Starting a thread from a ticket.** When the clicking client's `wayfinder.startTicketThread` returns, it navigates to the new thread and writes that thread's right panel state once: open, the `wayfinder` surface active, seeded with the map slug and ticket number (ticket 10), not maximized even when the source panel was, so the new thread's chat is visible. This is the direct result of a click, so `proactivePanelsEnabled` does not gate it. Threads started by an agent (ticket 13) or by another client neither navigate nor open anything. A checkout with maps never opens the tab on its own.

**Non-canvas path to frontier tickets.** This ticket adds no frontier list of its own. It assumes ticket 06's empty-selection view lists the open map's frontier tickets, in `frontier` order, as buttons that select the star, which reaches the readout and Start without the canvas; the problems rows above do the same for broken tickets. Tab order in the body is picker, Fit (ticket 05), problems row, canvas, readout. If ticket 06 decides otherwise, it must still supply that list.

**Hit every surface.** Entry points: "+" menu, launcher, palette, reopen-closed; no keybinding or settings, by decision. Clients: web and desktop share this code; mobile is out of scope. Providers: none involved. Agents: covered by ticket 13. Contracts: no change. Reverse states: close, reopen, and Retry. Connection modes: the same subscription local, remote, and tunnel; a read-only connection gets state 3. Docs: the build adds one concise Wayfinder section to the user guide in `docs/user/` covering where maps live and how to open the tab.

**Excluded.** A `wayfinder.toggle` keybinding and a default key. A settings toggle to hide the tab. Hiding or disabling the entry when the checkout has no maps. Opening the tab automatically when a checkout has maps, or through proactive panels. A "Chart a map" button that pre-fills the composer. Separate copy for a missing versus an empty `.plan/maps/`. A blocking error state for map-level or ticket-level problems. Persisting the problems row's expanded state. Opening the tab in a thread started by an agent or another client. Carrying the source panel's maximized state to the new thread. The `Sparkles` icon.

Amended by [Spec handoff](./15-spec-handoff.md): the user docs go in a new `docs/user/wayfinder.md`; problem rows display the contract's root-relative `path` as is.
