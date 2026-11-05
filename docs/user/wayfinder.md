# Wayfinder

Wayfinder shows the plan maps in your checkout and starts a thread on the next ticket.

## Where maps live

Maps are Markdown files in `.plan/maps/<slug>/` at the root of the checkout. Each map has a `map.md` and a `tickets/` folder. Ask an agent to chart one with the `wayfinder` skill. A worktree has its own `.plan/`, so a thread in a worktree shows that worktree's maps.

## Open the tab

Open **Wayfinder** from the right panel's tab menu or the command palette. Each star is a ticket. Select one to read it, or use the Frontier and All tickets lists under the map.

## Start a ticket

The frontier is every open ticket whose blockers are all resolved. Select a frontier ticket and choose **Start thread**. T3 Code claims the ticket for a new thread, writes `claimed_by` and `claimed_at` into the ticket file, and opens that thread with the map beside it. The thread uses the project's default model and permission mode.

If Start is disabled, the reason appears next to it, such as the blockers that are still open.

## Claims

A claimed ticket shows the thread that holds it and that thread's state:

- **Working**: the thread is running now.
- **Needs you**: the thread is waiting for an approval or an answer, or its turn ended.
- **Unattended**: no open thread holds the claim, or the claim is more than three days old with nothing running.

Deleting a thread releases its claims on open tickets. To hand a ticket to a new thread, choose **Release**, then **Start thread**. Releasing a Working or Needs you claim asks you to confirm first.
