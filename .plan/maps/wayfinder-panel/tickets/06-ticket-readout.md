---
type: grilling
blocked_by: [05]
undermined_by: []
assets: []
---

# Ticket readout

## Question

What the readout shows when a star is selected: title, type, status, the question, done-when, blockers with their answers or a link to them, assets, and the claiming thread. How it sits beside the canvas at panel width and when maximized, and how the map's own material (destination, notes, decisions, fog, out of scope) is reached when no star is selected.

## Done when

The answer fixes the readout's fields and order, its placement at both panel sizes, the empty-selection view, and the touch target and type sizes it must meet.

## Answer

Decided on 2026-11-04 by a subagent standing in for the user, at the user's request, after a self-run grilling round.

**One readout region, two contents.** The tab is the top row (map picker from ticket 10, Fit button from ticket 05), the canvas, and a readout region that is always present. With a ticket selected the region shows the **ticket readout**. With none selected it shows the **map readout**. Because the region never appears or disappears on selection, selecting a star never resizes the canvas, which keeps ticket 05's rule that selecting a visible star costs one paint and moves nothing. The readout never overlays the canvas, so the renderer's insets stay zero.

**Placement.** Decided by a container query on the tab root, not by the `maximized` flag, so a panel dragged wide gets the same layout as a maximized one.

| Tab width                                  | Layout                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Below 760 px (default panel, about 540 px) | Stacked. Canvas on top, `flex-1`, at least 240 px tall. Readout below with a 45% height basis, at least 224 px, its own `ScrollArea`, hairline `border-t`.            |
| 760 px and wider (maximized, about 940 px) | Side by side. Canvas on the left, fills the rest (about 580 px when maximized). Readout column on the right, 360 px fixed, its own `ScrollArea`, hairline `border-l`. |

No user-draggable splitter. Crossing the threshold resizes the canvas, which refits while `fitted` (ticket 05) and paints once.

**Ticket readout, in order.** Everything above the body comes from the snapshot summary and renders at once; only the body waits on `readTicket`.

1. Header row: a back button ("Map overview", arrow-left icon, `Button` `size="sm"`), then the number in tabular numerals, a status `Badge` (open, claimed, resolved, out of scope, with `info`, `warning`, `success`, `outline` variants), and a type `Badge` when `type` is not null.
2. Title, the ticket's H1, `text-base` semibold, wrapping, never truncated. It is a heading with `tabIndex={-1}`.
3. Action row (see claim states below).
4. Problems, when the summary has any: one `Alert` (warning) listing each `reason` in plain words with its path. It sits above the body because it explains a disabled Start.
5. Blocked by and Undermined by: one row per number with number, title, and status from the snapshot. Each row is a button that selects that ticket. A missing blocker shows its number and "not found". Answers are reached by selecting the blocker, not inlined.
6. Body sections from `readTicket`, in file order: Question, Done when, any other H2 sections, then Answer or Ruled out. Each has a small section label (`text-xs`, medium, muted) and markdown below it.
7. Assets: each entry as a link to `.plan/maps/<slug>/assets/<entry>` (chartr resolves asset paths against the map's `assets/`), through the same path-link handling the markdown uses.

The claimant chip is part of the action row, not a separate field.

**Map readout, in order.**

1. Progress line: `7 of 14 resolved · 3 on the frontier`, `text-xs` muted, tabular numerals, from the snapshot.
2. Snapshot and map problems, when present: one warning `Alert`.
3. Destination, expanded, from `readMap`.
4. **Frontier**: one row per number in the map's `frontier`, in snapshot order, showing number, title, and type. Each row is a button that selects the ticket. With an empty frontier: "Nothing on the frontier." This is the non-canvas path to frontier tickets ticket 05 requires.
5. All tickets: a `CollapsibleSectionHeader` (panel variant), collapsed, listing every ticket by number with its status, rows as buttons that select. It gives keyboard and screen-reader users the whole map, and costs nothing beyond snapshot data already on the client.
6. Notes, Decisions so far, Not yet specified, Out of scope: each a `CollapsibleSectionHeader`, collapsed by default, expanding to its markdown. Expansion state lives in component memory and is not persisted.

**Selection and focus.** A star click, a frontier row, an All tickets row, or a blocker row all write the selection through ticket 10's `setWayfinderSelection`. The back button clears `ticketNumber`. A click on empty canvas does nothing, so starting a pan never drops the selection. Selecting from a list or a blocker row moves focus to the ticket title. Selecting on the canvas leaves focus on the canvas. The back button returns focus to the Frontier heading.

**Markdown.** Reuse `ChatMarkdown` the way `FileMarkdownPreview` does: `cwd` is the snapshot's `root`, `imageBaseDir` is the folder of the file the section came from (the ticket's `tickets/` folder or the map folder), `threadRef` is the active thread, `workspaceMutationId` is null, no `onTaskListChange` (the panel does not edit tickets). One `ChatMarkdown` per section, with the readout's own padding on the parent. Relative links such as `./tickets/07-start-thread-action.md` open as file links, as they do anywhere else.

**Loading and errors for `readTicket` and `readMap`.**

- Cache in memory, keyed by `cwd`, map slug, ticket number, and the summary's `fingerprint` (for `readMap`, the map's fingerprint; see amendment). A push with the same fingerprint does not refetch.
- First load: the snapshot-backed header renders, and the body area shows three `Skeleton` lines per expected section. No spinner.
- Refetch after a fingerprint change: the previous body stays on screen until the new one arrives. No skeleton flash.
- Error: an inline `Alert` in the body area, "Couldn't read this ticket." (or "this map"), the error's message below it, and a Retry `Button` (`size="sm"`). The snapshot-backed fields and the action row stay usable.
- `WayfinderTicketNotFoundError`: "This ticket file is gone." with no Retry. The next snapshot drops the ticket, and ticket 10's stale-memory rule clears the selection to the map readout.

**Action row per claim state (ticket 07).** Start is `Button` default size, the only primary control in the readout. When Start is disabled, the reason is visible text beside or below it, never only a tooltip, because a disabled button gets no hover.

| State                       | Shown                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontier, unclaimed         | Start thread. While the call is in flight: disabled with a `Spinner`. A typed refusal shows as a toast with its reason. On success the clicking client navigates to the new thread (ticket 09). |
| Open, not on the frontier   | Start disabled. Reason: "Blocked by 03, 05", naming unresolved blockers.                                                                                                                        |
| Frontmatter problem         | Start disabled. Reason: "Fix the frontmatter first", with the problem in the Problems alert.                                                                                                    |
| Claimed, shells not loaded  | Start disabled. No chip, state line, or Release until the environment's shell snapshot arrives.                                                                                                 |
| Claimed                     | Start disabled. Chip, state line, and Release from the claim table below, keyed by `claimSessionState` (ticket 14). Start appears once a push shows the claim gone.                             |
| Resolved or out of scope    | No Start and no Release. A leftover claim shows its chip only, as a link to the thread that did the work.                                                                                       |
| Client lacks the permission | Start disabled with "This connection can't start threads" from the command's `permissionAtom`. Release hidden without `filesystem:write`.                                                       |

**Claim table.** The single source for the claimant chip and state-line copy; tickets 07 and 14 point here. The state line sits beside the chip, `text-xs`.

| `claimSessionState`                                                                                     | Chip                                                                         | State line                                                                                                      | Release                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Working                                                                                                 | `ThreadContextChip` that opens the thread                                    | "Working"                                                                                                       | Ghost `Button` `size="sm"` with an inline two-click confirm (`useInlineActionConfirm`, moved out of `pullRequest/` in the build); confirming calls `releaseClaim` with `force: true` |
| Needs you                                                                                               | `ThreadContextChip`                                                          | "Needs you: waiting for approval", "Needs you: awaiting input", "Needs you: turn ended", or "Needs you: failed" | Same as Working                                                                                                                                                                      |
| Unattended, shell `null` (unknown id, archived, deleted while the server was down, another environment) | `UnresolvedChip` labelled "No open thread", tooltip the raw id and claim age | "Unattended: no open thread holds this claim"                                                                   | Ghost `Button` `size="sm"`, no confirm, no `force`                                                                                                                                   |
| Unattended, aged (idle, claim older than 72 h)                                                          | `ThreadContextChip`                                                          | "Unattended: claimed {n} days ago"                                                                              | Same as the row above                                                                                                                                                                |

No other claim copy exists: no archived note and no separate warning text. If a state flips to Working or Needs you between render and click, the server refuses the unforced Release (ticket 13) and the refusal shows as a toast.

**Permissions.** `wayfinder.startTicketThread` needs both `orchestration:operate` and `filesystem:write`, but `CLIENT_GUARDED_RPC_SCOPES` maps a method to one scope. The build adds a special case to `clientRpcRequiredScopes` in `packages/contracts/src/clientRpcPermissions.ts` that returns both, as it does for `gitPreparePullRequestThread`, so the command's `permissionAtom` and the server check agree.

Release is the reverse of Start, not a second action, so the readout still has one action.

**Sizes.** Web and desktop use the macOS pointer numbers as they apply in CSS pixels.

- Every control in the readout is at least 28 px tall: `Button` `size="sm"` or larger (never `xs`, `micro`, or the `icon-xs` and smaller icon sizes), list rows at least 28 px with 6 px between rows as in ticket 10, `CollapsibleSectionHeader` at its 32 px. Coarse pointers keep the button's existing 44 px hit expansion.
- Text: title `text-base`, body markdown at `ChatMarkdown`'s default, labels and metadata `text-xs` (12 px). Nothing below 11 px: no `text-3xs` or smaller, and badges use `size="default"`, never `sm`, whose desktop text is 10 px.
- Padding 16 px horizontal, 8 px steps vertically, 16 px between sections.
- Contrast: body and labels on the readout's `--card` background at least 4.5:1, using existing tokens (`--foreground`, `--muted-foreground`). No new colours.

**Excluded.** An overlay or bottom sheet over the canvas, which would need insets and a canvas reflow on each selection. A readout that appears only on selection, which resizes the canvas on every click. A user-resizable splitter. Switching layouts on the `maximized` flag. Inlining blockers' answers. Intercepting markdown links to other tickets so they select stars. Persisting section expansion. Deselecting on an empty-canvas click. Escape as a deselect key. Refetching `readMap` on every push in place of a map fingerprint.

Amended by [Session status on stars](./14-session-status-on-stars.md): the claim table's states come from `claimSessionState`.

Amended by [Spec handoff](./15-spec-handoff.md): the ticket readout renders `readTicket` sections in file order with no reordering; the map readout adds a muted 12 px checkout line under the progress line, "Worktree · {root}" or "Project root · {root}"; `CLIENT_GUARDED_RPC_SCOPES` lists `orchestration:operate` for `wayfinder.startTicketThread` and the `clientRpcRequiredScopes` special case adds `filesystem:write`.
