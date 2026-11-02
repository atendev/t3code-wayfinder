---
type: grilling
blocked_by: [05, 07]
undermined_by: []
assets: []
---

# Session status on stars

## Question

chartr overlays whether a claiming session is working, idle, or waiting on the user. Ticket 07 resolves `claimedBy` to a thread shell on the client, and the shell already carries `status` and `archivedAt`. Does a claimed star show its thread's runtime state, which states it distinguishes (running, waiting on the user, idle, archived or stale, unknown claimant), and how it draws them in the star-map without a continuous repaint? Decide whether the state comes only from client thread data or needs anything new in the snapshot.

## Done when

The answer lists the states shown, the thread fields each one reads, how each is drawn on a star, and confirms no snapshot change or names the one required.
