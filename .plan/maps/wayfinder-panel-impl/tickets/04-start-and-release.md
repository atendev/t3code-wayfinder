---
type: task
blocked_by: [03]
undermined_by: []
assets: []
---

# Start a ticket thread and release its claim

## Question

Let a user start a thread on a frontier ticket from the readout and release a claim. That covers the pure `stampClaim` and `stripClaim` ported from chartr; `WayfinderMaps.startTicketThread` and `releaseClaim({ force? })` under the per-root lock, using the atomic write and `ThreadLaunchService.launch`, with the claim stripped if launch fails first and the thread id derived from `commandId`; the `WayfinderClaimReactor` on `thread.deleted`; the typed errors; both RPCs in `CLIENT_GUARDED_RPC_SCOPES` with `createEnvironmentRpcCommand`, plus the `clientRpcRequiredScopes` special case returning both scopes for `startTicketThread`; and `claimSessionState` in `packages/shared`, which `releaseClaim` calls on the claimant's projection. On the client it covers the action row and the claim table, the confirm before a forced Release for Working and Needs you only, and navigating to the new thread with its surface seeded and the tab open. It also adds the user docs page. The optional `caller` input on `startTicketThread` is ticket 06's.

Spec sections: [14. Start thread, claim, and release](../wayfinder-panel/spec.md#14-start-thread-claim-and-release), [15. Session state](../wayfinder-panel/spec.md#15-session-state) (derivation and claim table), [17. Accessibility and contrast](../wayfinder-panel/spec.md#17-accessibility-and-contrast), [18. Verification per build ticket](../wayfinder-panel/spec.md#18-verification-per-build-ticket).

## Done when

- Table tests for stamp and strip cover key order, `[03]` spelling kept, and idempotent restamp.
- Service tests cover concurrent starts (one claim, one `WayfinderTicketNotStartableError`), launch failure stripping the claim, `commandId` replay, the refusal without `force` for a Working or Needs you claimant, and an unforced release of an Unattended one.
- A reactor test drains `OrchestrationEffectWorkerV2` after `thread.deleted` and covers the still-open-only rule.
- Permission behavior tests are extended for both methods, including the two-scope start.
- A table test for `claimSessionState` in `packages/shared` covers Working, each Needs you reason, and Unattended for missing, archived, and idle over 72 h.
- The PR has captures of each action-row state and a short video of start through navigation, using the Replay provider.
- A concise `docs/user/wayfinder.md`, linked from `docs/README.md`, covers what the tab shows, how to start a ticket, and what an Unattended claim means.
- `vp run check:changed` passes, and the PR body has the "Hit every surface" walk and the docs check.
