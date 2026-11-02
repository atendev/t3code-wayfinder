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
