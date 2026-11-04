---
type: grilling
blocked_by: [03]
undermined_by: []
assets: []
---

# Map picker and remembered selection

## Question

How the user picks among several maps in one checkout, how the picker labels planning maps against `-impl` maps, what the panel remembers across thread switches and reloads (open map, selected ticket, camera), and where that memory lives given the right panel store already persists per-thread surfaces.

## Done when

The answer fixes the picker control, the label rule, the two memory horizons with what each keeps, and the store key.

## Answer

Approved by the user on 2026-11-03 after two grilling rounds.

**Picker.** The map title in the tab's top row. With two or more maps it is a menu trigger with a chevron, built from an existing `components/ui` menu or select without restyling. With one map it is a plain title with no chevron. The trigger and the menu rows are at least 28 pt tall with 6 pt between rows, the macOS pointer minimums. The empty state for zero maps belongs to ticket Entry points and empty state.

**Label rule.** Each row shows the map's `title`, then a second line with the `slug` and a progress count computed from ticket statuses in the snapshot, for example `7 of 14 resolved`. Rows sort by slug, so `foo-impl` sits next to `foo`. The panel does not mark or group `-impl` maps. The slug on the second line already shows the suffix. No contract field is added.

**Memory horizons.**

- Survives a reload: the open map slug and the selected ticket number. Both are written only when the user clicks; the renderer's `select()` never emits `onSelect`, so a remount or reload restoring the selection cannot write the store (ticket 12). Ticket numbers are never reused, so the number is a stable key without the fingerprint.
- Survives thread switches but not a reload: the camera. It lives in memory, keyed by thread key and map slug, and needs no cleanup because it holds a few numbers per thread and map visited in one page load. After a reload the view fits the whole map, or eases once to the selected star when one is remembered (amended by ticket 12, accepted by the user on 2026-11-04).

**Store key.** A singleton surface `{ id: "wayfinder", kind: "wayfinder", mapSlug?, ticketNumber? }` in the thread's existing `surfaces`, under `byThreadKey[scopedThreadKey(ref)]`. Memory is per thread, like every other surface. A new action `setWayfinderSelection(ref, …)` writes it through `automaticUpdate`, as `setPullRequestDetailTab` does, so a click on a star does not bump the user-action revision that gates proactive opens. Picking a different map clears `ticketNumber`, because numbers repeat across maps. Closing the tab drops the surface and forgets the selection, and the closed-view store restores it on "reopen closed tab". A fresh open from the palette starts at the default map. `migratePersistedRightPanelState` passes unknown surface kinds through, so no `RIGHT_PANEL_STORAGE_VERSION` bump is needed.

**Stale memory.** Resolved at read time, never written back. A map slug missing from the snapshot falls back to the default map. A ticket number missing from the open map keeps the map and clears the selection. Before the first snapshot arrives the tab shows loading and resolves nothing. The lookup uses the slug only, with no `cwd` stored, so a thread moved to another worktree keeps its pick when the same slug exists there.

**Default map.** The first map in slug order that has a non-empty frontier. If none has one, the first map in slug order.

**Start-thread seeding.** The client that clicked "start a thread" writes the map slug and ticket number into the new thread's wayfinder surface once launch returns. Threads started by an agent or by another client are not seeded and use the default map. `WayfinderMaps.startTicketThread` stays unchanged. Whether the panel also opens belongs to ticket Entry points and empty state.

**Excluded.** A segmented control or tab strip (overflows at three or more maps in a narrow panel). A list-first drill-in (adds a click to the single-map case). A client-side `-impl` tag, grouped menu sections, and a map-kind contract field. A persisted camera (rewrites the whole store JSON per write, and a stored position can point at empty space after the watcher adds tickets). A separate selection store. Per-checkout memory (thread A would jump to thread B's ticket). Writing fallbacks back to the store. A "most recently changed" default, which needs a snapshot timestamp.
