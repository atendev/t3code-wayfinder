---
type: grilling
blocked_by: [03]
undermined_by: [01]
assets: []
---

# Start a thread from a ticket

## Question

The exact prompt the action sends, which provider and model the new thread uses and whether the user picks them, whether the thread runs in the active checkout or a new worktree, how the service writes `claimed_by` and `claimed_at` with the thread id, and when the claim is cleared: thread deleted, thread finished without an answer, or claim older than some age. Also what the action does when the ticket is already claimed or not on the frontier.

Ticket 03 ships `claimedBy` as a raw string with no claimant kind, so a chartr session id and a T3 thread id look the same. This ticket decides how the client resolves the id against thread data and what it shows for an unknown claimant.

## Done when

The answer gives the prompt text verbatim, the thread creation call it goes through so agents and scheduled tasks reach the same path, the claim write and every claim clear condition, and the disabled or warning states for claimed and blocked tickets.

## Answer

Approved by the user on 2026-11-02. A research subagent drafted the answers from the codebase and chartr, and the user accepted all five defaults.

**Prompt.** Sent verbatim, with a `skill` context record for `wayfinder`:

```
$wayfinder Work ticket {NN} of the {slug} map: .plan/maps/{slug}/tickets/{file}. Load .plan/maps/{slug}/map.md and that ticket only.
```

`$wayfinder` is T3's provider-neutral skill token (`packages/shared/src/composerInlineTokens.ts`); the Claude adapter rewrites it to `/wayfinder` with the rest as arguments (`apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts`), which still works if the skill becomes `disable-model-invocation`. This replaces the charting decision's literal `/wayfinder`. Providers without the skill installed get the same prompt; the paths are enough to work from. The thread title is `{NN} {ticket title}` with `generateTitle: false`.

**Provider and model.** No picker. The server resolves the project's effective defaults as a callerless `t3_thread_launch` does (`apps/server/src/mcp/toolkits/project/handlers.ts:170-205`): model selection, runtime mode, interaction mode `default`.

**Checkout.** The active checkout, the snapshot's `cwd`: `existing_worktree` when the active thread is in a worktree, `root` otherwise. A new worktree would put the claim and the Answer on another copy of `.plan/`, invisible to the panel until a merge. Revisit for `-impl` maps.

**Creation call.** `WayfinderMaps.startTicketThread({ cwd, projectId, mapSlug, number, commandId })`, a named `Effect.fn`, calls `ThreadLaunchService.launch` (`apps/server/src/orchestration-v2/ThreadLaunchService.ts`), the path the WS `launchThread` handler, MCP `t3_thread_launch`, and scheduled tasks already share. The client reaches it through `wayfinder.startTicketThread` via `createEnvironmentRpcCommand`; the thread id derives from `commandId`, as at `handlers.ts:92-100`, so a retry replays instead of creating a second thread. A matching `wayfinder.releaseClaim({ cwd, mapSlug, number })` is the reverse. Ticket 13 exposes the same methods to agents.

**Claim write.** Inside a per-root `Semaphore(1)`: re-read the ticket from disk, refuse unless it is on the frontier and unclaimed, preallocate the thread id, stamp the claim, then call `launch`. If `launch` fails before the thread exists, strip the claim; after the thread is accepted, keep it. `claimed_by` is the raw thread id with no prefix; `claimed_at` is UTC RFC 3339 to the second (`2026-11-02T14:03:00Z`), as chartr writes it (`internal/server/spawn.go:305`). Port chartr's line-based `stampClaim` and `stripClaim` (`internal/server/claim.go`) as pure, tested functions: claim keys go just before the closing `---`, other lines keep their order and spelling, restamping is idempotent. A YAML round-trip is excluded because it rewrites `[03]` as `[3]`. Write with `writeFileStringAtomically` (`packages/shared/src/atomicWrite.ts`) after `KnownWorkspaces.assertContains`, so the watcher never sees a half-written file. `wayfinder.startTicketThread` goes in `CLIENT_GUARDED_RPC_SCOPES` with both `orchestration:operate` and `filesystem:write`; `wayfinder.releaseClaim` needs `filesystem:write`. Ticket 03's "first guarded entry" means the first Wayfinder entry; the table already has others.

**Clearing the claim.**

- Thread deleted: a `WayfinderClaimReactor` on `streamDomainEvents`, in the shape of `PullRequestSyncReactor.ts:676-721`, handles `thread.deleted` and strips a claim whose `claimed_by` is that thread id, only while the ticket is still open.
- Release in the readout: the manual reverse state. It confirms first when the claimant is a live T3 thread.
- Turn ended or thread settled without an answer: no clear. Grilling threads end turns while waiting on the user.
- Thread archived: no clear, since unarchive exists. Shown as stale.
- Claim age: no expiry. Older than 72 h is shown as stale, matching chartr's lint.
- Resolved or ruled-out ticket: the leftover claim stays; it is inert.
- A deletion missed while the server was down shows as an unknown claimant with Release.

**States.** Start appears only for frontier tickets. Blocked tickets and tickets with a frontmatter problem show Start disabled with the blockers or the problem as the reason. Resolved and out-of-scope tickets show no Start. A ticket claimed by a live T3 thread shows Start disabled, a chip that opens the thread, and Release behind a confirm. A claim by an archived thread, an unknown id, or older than 72 h shows a stale warning with Release; Start appears once released. Takeover is two steps, Release then Start, never one. The server refuses with a typed `WayfinderTicketNotStartableError` carrying the reason, so a stale client fails cleanly.

**Claimant.** The client resolves `claimedBy` with `useThreadShell(scopeThreadRef(environmentId, claimedBy))` (`apps/web/src/state/entities.ts`), as `MarkdownThreadLink.tsx` does. Found: a `ThreadContextChip` with the title, plus a stale note when `archivedAt` is set. Not found: an `UnresolvedChip` labelled "Claimed by another session", the raw id and claim age in its tooltip. No claimant kind is added to the snapshot.

**Excluded.** A model picker or carrying the active thread's model. A new worktree per ticket. A client-composed launch followed by a client claim write. Launch-then-claim ordering. Clearing on archive, on turn end, or by age. A one-step takeover. Disabling Start for providers without the skill.

Amended by [Agent access to maps through MCP](./13-agent-access-mcp-tool.md): `startTicketThread` takes optional caller modes for the MCP path, and `releaseClaim` takes `force` and refuses without it only when `claimSessionState` is Working or Needs you; an Unattended claim releases without `force` or a confirm.

Amended by [Entry points and empty state](./09-entry-points-and-empty-state.md): when `startTicketThread` returns, the clicking client navigates to the new thread, whose panel opens on the Wayfinder tab.

Amended by [Session status on stars](./14-session-status-on-stars.md): archived threads leave the client shell index, so an archived claimant resolves as not found; the 72 h stale rule applies only to an idle claimant that is neither Working nor holding a pending request; the star, the readout, and the server's `releaseClaim` refusal share one `claimSessionState` in `packages/shared`.

Amended by [Ticket readout](./06-ticket-readout.md): the claimant chip and state-line copy for every state is 06's claim table, which replaces the "Claimed by another session" label and the archived stale note; `clientRpcRequiredScopes` in `packages/contracts/src/clientRpcPermissions.ts` gains a special case returning both scopes for `wayfinder.startTicketThread`, like `gitPreparePullRequestThread`.
