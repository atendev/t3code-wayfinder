---
type: grilling
blocked_by: []
undermined_by: [01]
assets: []
---

# Map snapshot contract and service shape

## Question

What typed snapshot does the server push for a checkout's maps, and what service and RPC methods produce it? Cover the list of maps with slugs and titles, tickets with number, title, type, derived status, blocked_by, undermined_by, claim fields, and body, the frontier, and parse errors for malformed files. Decide whether the body ships in the snapshot or on demand per ticket, how the snapshot is keyed by checkout path, and where the schema lives in `packages/contracts`.

## Done when

The answer names the schema types, the service name and its methods following `docs/internals/effect-services.md`, the RPC methods and their scope entries in the server's `RPC_REQUIRED_SCOPES` (`apps/server/src/auth/RpcAuthorization.ts`), and a size estimate for a fifty-ticket map so the websocket cost is known. `CLIENT_GUARDED_RPC_SCOPES` holds mutations only, so these reads do not appear there.

## Answer

Approved by the user on 2026-11-02 after a grilling round and an independent review subagent.

**Service.** A new `WayfinderMaps` service in `apps/server/src/wayfinder/`, tag `t3/wayfinder/WayfinderMaps`. No existing service owns `.plan/`. Parsing, status derivation, and frontier derivation are pure functions beside it, tested without a filesystem. `KnownWorkspaces` comes from the environment. Every method is a named `Effect.fn("WayfinderMaps.<method>")`.

- `getSnapshot(cwd)` returns the current `WayfinderMapsSnapshot`.
- `streamSnapshots(cwd)` is a `Stream` of snapshots, current one first. Change detection belongs to ticket 04.
- `readTicket({ cwd, mapSlug, number })` returns one ticket's H2 sections as markdown strings: `question`, `doneWhen`, `answer`, `ruledOut`, and any other sections in order.
- `readMap({ cwd, mapSlug })` returns `map.md`'s H2 sections the same way (Destination, Notes, Decisions so far, Not yet specified, Out of scope), for the readout when no star is selected.

**Keying and root.** Every call takes `cwd`, the active thread's checkout. The server checks it with `KnownWorkspaces.assertContains` once when a subscription starts, not on each push, because the check runs a query and `git worktree list`. `readTicket` and `readMap` check on every call, as `WorkspaceFileSystem.writeFile` does; they run on a click, not per push. Maps are found at the git top-level of `cwd`, falling back to `cwd` itself, so a project rooted in a monorepo subfolder still finds the repository's `.plan/maps/`. A worktree's top-level is the worktree. The snapshot echoes `cwd` and the resolved root. Whether the checkout is a worktree is shown from the client's thread data.

**RPC.** `wayfinder.subscribe` (stream, payload `{ cwd }`) and `wayfinder.readTicket` and `wayfinder.readMap` (unary). All three go in `RPC_REQUIRED_SCOPES` under `AuthFilesystemReadScope`, as `projects.readFile` does, since they return file contents. None goes in `CLIENT_GUARDED_RPC_SCOPES`; ticket 07's claim write is the first guarded entry. The stream's success type is a tagged union, starting with `{ _tag: "snapshot", snapshot }`, so ticket 04 can add delta events without breaking the contract. On the client the tag joins `EnvironmentSubscriptionRpcTag` and uses `createEnvironmentRpcSubscriptionAtomFamily`, as worktree setup does.

**Schema.** `packages/contracts/src/wayfinder.ts`, exported from the index.

- `WayfinderMapsSnapshot`: `cwd`, `root`, `maps`, `problems` (snapshot-level, such as a folder without a readable `map.md`, which is not listed as a map).
- `WayfinderMapSummary`: `slug`, `title` (the H1 of `map.md`), `tickets`, `frontier` (ordered ticket numbers), `problems`.
- `WayfinderTicketSummary`: `number` (integer), `slug`, `title`, `type` (`grilling | research | prototype | task`, or `null` when frontmatter is invalid), `status` (`open | claimed | resolved | out_of_scope`), `frontier` (boolean, what chartr's `visualState` reads), `blockedBy` and `underminedBy` (integer arrays), `assets`, `claimedBy` and `claimedAt` (raw strings, so foreign session ids and bad timestamps never fail decoding), `fingerprint` (a hash of the file's bytes, which the parser already read, so a client knows a cached `readTicket` is stale; mtime was rejected because two quick writes can share one), `problems`.
- `WayfinderProblem`: `{ path, reason }`. Reasons are a closed set: `unreadable`, `invalid-filename`, `missing-frontmatter`, `invalid-frontmatter`, `invalid-type`, `missing-question`, `missing-done-when`, `both-closing-headings`, `duplicate-number`, and map-level `missing-title` and `missing-destination`.
- Errors: `WayfinderMapsReadError` and `WayfinderTicketNotFoundError`, each keeping the underlying failure (such as `UnknownWorkspaceError`) as `cause`.

**Parsing.** Tolerant and per file. A ticket with a problem stays a star with the problem attached, so the layout and its dependents' edges do not move while an agent is mid-write. A ticket drops out only when it is unreadable, its filename has no number, or its number is a later duplicate, and then appears in the map's `problems`. Both closing headings resolve to `resolved`, the first match in chartr's status table. Problems never change status or frontier: both follow chartr's tables alone, so a ticket missing `## Done when` can still be on the frontier, with its problem shown. Frontmatter keys are validated one at a time: a key that fails (`invalid-frontmatter`, `invalid-type`) takes its default (`type` is `null`; `blockedBy`, `underminedBy`, and `assets` are empty, as chartr treats absent keys) while the other keys keep their values, so `claimedBy` and `claimedAt` are read as raw strings whenever the block parses at all. The one exception to the rule above is any frontmatter problem (`missing-frontmatter`, `invalid-frontmatter`, `invalid-type`): a default could hide a real blocker or claim, so the ticket's `frontier` is `false`. Its status still follows chartr's table: closing headings decide `resolved` and `out_of_scope` regardless of frontmatter, then a `claimedBy` that was read gives `claimed`, otherwise `open`. Ticket 07's start action refuses a ticket off the frontier, so it refuses these too. A missing H1 falls back to the filename slug for a ticket and the folder slug for a map, so `title` is always a string. When two files share a number, the first in filename order owns it and is the star that edges, the frontier, and `readTicket` resolve to; each later file drops into the map's `problems` as `duplicate-number`. A missing blocker keeps its edge. Numbers parse as integers, so `1` and `01` collide as `duplicate-number`. Unknown frontmatter keys and a stored `status` are ignored. Per-file reads are capped at 1 MiB, as `PROJECT_READ_FILE_MAX_BYTES` is.

**Size.** A serialized ticket summary measures 275 bytes unclaimed and 366 bytes claimed with one asset, so a fifty-ticket map is 14 to 18 KB. The snapshot carries every map in the checkout and is resent whole on each push, so the cost is about 15 KB per map per push. Inlining bodies would add 30 to 175 KB per map, from this map's 0.6 to 3.5 KB ticket files. No relay frame cap exists; the cost argument is the performance rule.

**Excluded.** Bodies in the snapshot (chartr's choice; rejected for push size). Validating `cwd` the way `projects.readFile` does, which never checks it. Dropping malformed tickets. A per-ticket claimant kind: the snapshot cannot tell a T3 thread claim from a foreign one, so ticket 07 resolves the id against thread data and shows an unknown claimant otherwise.

Amended by [Ticket readout](./06-ticket-readout.md): `WayfinderMapSummary` carries a `fingerprint` of the `map.md` bytes so a cached `readMap` knows when it is stale.

Amended by [Spec handoff](./15-spec-handoff.md): `readTicket` and `readMap` return `{ fingerprint, title, sections: { heading, markdown }[] }` in file order in place of named fields; `WayfinderProblem.path` is root-relative with forward slashes; `frontier` is ordered by ticket number ascending; start and release refusals are `WayfinderTicketNotStartableError { reason, blockers? }` and `WayfinderClaimLiveError { state, threadId }`.
