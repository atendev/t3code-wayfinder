---
type: grilling
blocked_by: [03]
undermined_by: []
assets: []
---

# Watcher and refresh semantics

## Question

Which existing server watcher pattern does the `.plan/maps` watcher reuse, what debounce it applies while an agent writes several files in one step, whether the server pushes a whole snapshot or a diff on each change, and what happens over remote and tunnel connections when a map changes often. Decide also when the watcher starts and stops relative to the panel being open and the thread being active.

Ticket 03 fixed the stream as a tagged union that starts with a full `snapshot` event and keeps malformed tickets as stars with problems attached. This ticket decides whether delta events are added to that union.

## Done when

The answer names the watcher module to copy, the debounce window, the push shape, the start and stop conditions, and how a malformed file mid-write is kept from flashing an error.

## Answer

Approved by the user on 2026-11-02. A research subagent drafted the answers from the codebase, and the user accepted all three defaults.

**Watcher.** Copy `apps/server/src/environmentTheme.ts:155-216`: `fs.watch` with a trailing debounce, refresh serialized by `Semaphore(1)`, an `Equal.equals` check that skips publishing an unchanged value, a `PubSub.sliding(1)` with a `seq`, and `streamChanges` emitting the current state first. Do not copy its `makeDirectory` call: the watcher never creates `.plan/maps`. Hold one watcher per resolved git top-level in a `LayerMap`, as `WorkspaceSearchIndexMap` does (`apps/server/src/workspace/WorkspaceSearchIndex.ts:551-559`), and watch `<root>/.plan/maps` recursively (Node 22.16 supports this on Linux, macOS, and Windows). When the folder is missing, watch its parent non-recursively and move to the folder with `Stream.switchMap` once it appears, as `serverSettings.ts:1246-1258` follows a symlink target. Each subscriber's stream maps the shared root snapshot to its own `cwd`.

**Debounce.** 250 ms trailing. Config watchers use 100 ms for one file save; a Wayfinder step writes `map.md` and a ticket back to back, and 250 ms keeps that pair in one push. Writes seconds apart are not merged and need not be.

**Push shape.** The whole `snapshot` event on every change. No delta tags are added to the union. A push is skipped when the parsed snapshot equals the last one published. The websocket runs `perMessageDeflate` with context takeover (`apps/server/src/server.ts:369`), so a re-sent snapshot that differs in one ticket costs a few hundred bytes on the wire. The union stays open, so deltas can be added later without breaking the contract.

**Remote and tunnel.** No separate path. Debounce, the equality skip, and compression cover map edits at agent-step frequency. If a map is ever seen changing faster than once a second for long stretches, the fallback is a `Stream.throttle` of one push per second on every connection; it is not built now.

**Start and stop.** The watcher runs while at least one `wayfinder.subscribe` stream is open for its root. The panel being open starts it; whether the thread is active does not matter. Threads and clients on the same checkout share one watcher. After the last subscriber leaves, the watcher stays for an idle TTL of 30 s, so switching tabs does not rebuild it, then stops.

**Mid-write files.** The debounce absorbs most partial writes. On top of it: when a refresh would give a ticket a problem it did not have in the last published snapshot, the server keeps that ticket's previous summary and re-reads once after 500 ms, then publishes whatever the re-read finds. A real problem still shows within about 750 ms. The UI does nothing special; ticket 03's fingerprint keeps a cached `readTicket` honest.

**Excluded.** Refreshing only at turn end, as Files and git status do (`RunFinalizationService.ts:101-105`): it misses writes from chartr, editors, and other threads' claims. A turn-end refresh as a backup for filesystems where `fs.watch` is unreliable, such as network mounts: not built until someone reports the problem. Delta or per-map replacement events. A remote-only throttle, which would need connection-mode plumbing that does not exist. Keying watchers by `cwd`, which would run two watchers on the same files for two projects in one monorepo.
