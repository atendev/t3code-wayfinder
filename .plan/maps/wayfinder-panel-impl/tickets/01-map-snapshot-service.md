---
type: task
blocked_by: []
undermined_by: []
assets: []
---

# Map snapshot service and subscription

## Question

Build `packages/contracts/src/wayfinder.ts` and the `WayfinderMaps` service so that a client can subscribe to a checkout's maps and fetch a ticket or map body, with no client code. That covers the pure parser with status, frontier, and problem derivation; `getSnapshot`, `streamSnapshots`, `readTicket`, and `readMap`; git top-level root resolution; the per-root watcher in a `LayerMap` with the 250 ms debounce, equality skip, 500 ms mid-write re-read, missing-folder follow, and 30 s idle TTL; the ticket and map fingerprints; and the three RPCs in `RPC_REQUIRED_SCOPES` under `AuthFilesystemReadScope`.

Spec sections: [3. File format, status, and frontier](../wayfinder-panel/spec.md#3-file-format-status-and-frontier), [4. Snapshot contract](../wayfinder-panel/spec.md#4-snapshot-contract), [5. `WayfinderMaps` service, root, and RPCs](../wayfinder-panel/spec.md#5-wayfindermaps-service-root-and-rpcs), [6. Watcher and refresh](../wayfinder-panel/spec.md#6-watcher-and-refresh), [18. Verification per build ticket](../wayfinder-panel/spec.md#18-verification-per-build-ticket).

## Done when

- Table tests for the parser cover every `WayfinderProblem` reason, duplicate numbers, `1` versus `01`, both closing headings, per-key frontmatter defaults, and frontier `false` on any frontmatter problem.
- Watcher tests run on `TestClock` with the filesystem change signal injected, covering debounce merge, skip-unchanged, the re-read, and the TTL, plus one `it.live` case that awaits a published snapshot after a real write to a temp dir.
- The scope table test is extended for the three RPCs.
- The PR carries a short runtime transcript of a subscription receiving a push after a ticket edit. No UI, so no captures.
- `vp run check:changed` passes, and the PR body has the "Hit every surface" walk and the docs check.
