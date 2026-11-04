# Wayfinder panel build

## Destination

The Wayfinder tab ships in web and desktop as `../wayfinder-panel/spec.md` describes, and agents reach start and release through MCP. Six stacked PRs, one per ticket, are merged to `main`, each with green CI, its tests, and its captures. Nothing in the spec is left unbuilt or changed without a new ticket on the `wayfinder-panel` map.

## Notes

- [`../wayfinder-panel/spec.md`](../wayfinder-panel/spec.md) is the source of truth. A build session loads this map, its one ticket, and the spec sections the ticket names. It does not reread the `wayfinder-panel` tickets unless the spec cites one for a detail.
- Domain and vocabulary are the [`wayfinder-panel` map](../wayfinder-panel/map.md)'s Notes, plus **session state** (Working, Needs you, Unattended, derived by `claimSessionState` in `packages/shared` on client and server, never stored). Read `AGENTS.md` first. Server tickets read `docs/internals/effect-services.md` before touching `apps/server`.
- Build sessions do not call `grilling` or `domain-modeling`; the decisions are made. If the spec is silent or wrong on something the build needs, stop, open a ticket on the `wayfinder-panel` map, and wait. Do not decide it in the PR.
- Skills by ticket. Every ticket calls `tdd` for the logic it lists under tests. UI tickets (02, 03, 04, 05) also call `apple` and `impeccable`, and the session runs `test-t3-app` once after integrating, using the `Replay (dev)` provider wherever a turn is needed. Ticket 06 reads `evals/README.md` and runs the evals it names. No ticket uses `diagnose` unless a failure needs runtime instrumentation.
- Branches and PRs. One ticket is one request and one PR. `AGENTS.md` asks for a maintainer's request before splitting, so the first build session asks the maintainer to confirm the split before opening PR 01. The maintainer confirmed six stacked PRs on 2026-11-04. If they decline, the same six tickets land in order as commits on one branch and one PR, and every Done-when still applies per ticket. Ticket 01 branches from `main` and each later ticket from the previous ticket's branch (`wayfinder/01-snapshot-service`, and so on), and its PR targets that branch until the one below merges, then is retargeted to `main`. PRs merge in ticket order. Conventional titles; the body ends with the model and harness. Captures go to GitHub, never into the repo.
- Every Done-when includes `vp run check:changed` passing, a written "Hit every surface" walk in the PR body naming which entries applied, and a docs check against the `AGENTS.md` documentation rules.
- The flat-trace is manual and required for any ticket that changes `apps/web/src/components/wayfinder/starmap/` or the host's calls into it (02, 03, 05). Use an uncommitted local paint counter or a DevTools performance recording, and paste the paint table (mount, idle 3 s and 5 s, click a star, resize, maximize, plus the ticket's own rows) into the PR. The committed proof is the stop-table test.

## Decisions so far

- [Map snapshot service and subscription](./tickets/01-map-snapshot-service.md) — contracts, parser, per-root watcher and three read-scoped RPCs. The first read waits for the watch to arm. Accepted on local checks because the fork has no Blacksmith runners.

## Not yet specified

Nothing. Gaps found while building become tickets on the `wayfinder-panel` map.

## Out of scope

- Mobile client. The contract will carry a snapshot a mobile view could consume later, but no mobile UI in this effort.
- GitHub or other remote trackers. Local markdown only.
- Editing tickets, edges, or answers from the panel. Agents and the tracker own writes, except the claim.
- One PR for the whole build, layer-by-layer tickets, the renderer port as its own PR, a feature flag to hide the tab between merges, and a separate docs ticket ([Spec handoff](../wayfinder-panel/tickets/15-spec-handoff.md)).
- A new worktree per build ticket from the panel. Build sessions branch by hand.
