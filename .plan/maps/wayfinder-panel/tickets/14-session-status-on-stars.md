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

## Constraints from ticket 12

Nothing on the star-map moves on its own (ticket 12). Orbit, crawl and blink are gone, so the states must be told apart by static shape and mark, with at most two hues. chartr's `nonColorSignature` joins `motion|moon|marks`; it becomes shape plus mark, and `implementing` and `blocked` collide until this ticket picks shapes. A session-state change repaints once and never flares.

## Answer

Decided on 2026-11-04 by a subagent standing in for the user, at the user's request.

A claimed star shows its claimant's **session state**, and there are three of them. Each one tells the user whose move it is. **Working** means the agent has the ball, so leave it alone. **Needs you** means the user has the ball, so open the thread. **Unattended** means no open thread holds the claim, so Release it or take it over. The renderer derives all three from the snapshot's `status`, `claimedBy`, and `claimedAt` plus the client's thread shells. Nothing new goes in the snapshot.

**Code fact this rests on.** Archived threads leave the client's shell index. `applyShellStreamEvent` drops a `thread.updated` whose `location` is not `active` from `snapshot.threads` (`packages/client-runtime/src/state/shellReducer.ts`), and `threadShellAtom` indexes only `threads` (`threadShell.ts`, `environmentThreadIndexAtom`). So `useThreadShell` returns `null` for an archived claimant, and ticket 07's "found, with `archivedAt` set" branch never fires in practice. Archived and unknown claimants both arrive as "not found". That is why they share one state here, and the `archivedAt` check stays only as a guard.

**Derivation.** A pure function `claimSessionState(shell, claimedAt, now)` sits beside the panel in `apps/web` and is tested table-first. It runs only for tickets whose snapshot `status` is `claimed`. A leftover claim on a resolved or out-of-scope ticket stays inert and gets no mark (ticket 07). Rules apply top to bottom, and the first match wins:

| State                  | Fields read (`EnvironmentThreadShell` from `packages/client-runtime/src/state/models.ts`, plus snapshot fields)                                                                                                                | Mark on the star (screen px, fixed size at every zoom)               | Non-colour signature       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------- |
| (shells not loaded)    | the environment's shell snapshot atom is still `null`                                                                                                                                                                          | Solid orbit ring only, in `--warning-foreground`                     | `orbit:solid`              |
| Unattended             | shell is `null` (unknown id, archived, deleted while the server was down, or another environment), or `archivedAt !== null`                                                                                                    | Dashed orbit ring `[3,3]` in `--muted-foreground`, no moon           | `orbit:dashed`             |
| Needs you              | `hasPendingApprovals`, `hasPendingUserInput`, or `pendingSubagentRequest !== null`, which come from `pendingRuntimeRequest.kind` as the sidebar's `approval` and `input` statuses do                                           | Solid orbit, filled moon, and a concentric halo ring around the moon | `orbit:solid\|moon\|halo`  |
| Working                | `threadRuntimeIsActive(runtime)`, meaning `runtime.status` is `preparing`, `queued`, `starting`, `running`, or `waiting`. This includes `blockedOnThreadWait`, because an agent waiting on its own subagent still has the ball | Solid orbit, filled moon, and two trail dots behind it               | `orbit:solid\|moon\|trail` |
| Unattended (by age)    | otherwise, when `claimedAt` parses and is more than 72 h before `now`                                                                                                                                                          | Same as Unattended                                                   | `orbit:dashed`             |
| Needs you (turn ended) | anything else: `runtime` is `null` or `runtime.status` is `idle`, `completed`, `interrupted`, `cancelled`, `rolled_back`, or `failed`, including `lastErrorClass === "usage_limit"`                                            | Same as Needs you                                                    | `orbit:solid\|moon\|halo`  |

Idle, failed, and a pending approval or question merge into Needs you. A grilling thread ends its turn while it waits for an answer in prose (ticket 07). That is the user's move just as much as an approval prompt is, and the star cannot tell those cases apart honestly. The sidebar already makes a pending approval loud. The readout line below says which case applies. Pending guest messages (`pendingGuestMessageCount`) are not read, because they concern the thread's owner, not the ticket.

Age demotes a claim to Unattended only when its thread is neither Working nor Needs you on a pending request. A 4-day-old claim whose agent is running is not stale. This amends ticket 07's unconditional "older than 72 h is stale", and the readout uses the same function, so the star and the readout always agree. An unparseable `claimedAt` never makes a claim stale by age.

**Drawing.** These marks replace chartr's moon grammar and ticket 12's double claimed ring.

- Every claimed star draws one orbit ring at the star's screen core radius plus 6 px, with a 1.5 px stroke. The ring replaces the fixed claimed ring, so a claimed star has a ring from the first paint. Session state only changes how the ring is drawn and what sits on it.
- The moon sits at a fixed angle of −45° (upper right) on every star, so the eye finds it in the same place each time. It is a filled dot of 3 px radius in `--warning-foreground`. Working adds two dots of 1.5 px radius at 25° and 50° behind the moon, counter-clockwise, at alpha 0.7 and 0.45. Needs you adds a 1.5 px ring of 5.5 px radius around the moon at full alpha.
- Unattended has no moon, which reads as a claim with nobody in it. It is a dashed muted ring around the amber claimed core. The out-of-scope star is a hollow muted ring at the core radius with no filled core, so the two do not collide.
- Hues: `--warning-foreground` (the claimed core's token from ticket 05) and `--muted-foreground`. That makes two, and the "hues ≤ 2" test stays. Both strokes meet ticket 05's 3:1 target against `--card` in light and dark. Under `prefers-contrast: more`, the trail dots draw at full alpha.
- The marks are sized in screen pixels, not world units, so they stay legible when the camera is zoomed out and still draw when labels hide below scale 0.22. The selection ring's radius becomes at least the orbit radius plus 4 px, so it never lands on the orbit. The label solver's obstacle for a claimed star becomes the orbit radius plus the halo extent, about 15 px at scale 1 as today. The 14 px and 22 px hit radii stay as they are.
- `GRAMMAR` becomes `Record<"working" | "needs_user" | "unattended", { hue; orbit: "solid" | "dashed"; moon: boolean; marks: readonly ("trail" | "halo")[] }>`, and `nonColorSignature` joins `orbit|moon|marks`. The port's "distinct per state" test now passes, ending the `implementing`/`blocked` collision.

**Repaint.** The host passes `Record<number, SessionState>` to `setModel(tickets, sessions)`. The prototype's `setModel` already compares `sstate`, so a change marks the model dirty, wakes once, and paints once. Per ticket 12, a session-state change never flares and writes no ticker line. To keep streaming tokens from re-rendering the panel, the host reads states through a derived atom that returns only the enum per claimant (from `threadShellAtom`) and compares structurally. The panel then re-renders only when a state actually flips. No timer watches the 72 h boundary, because ticket 12 requires zero timers at rest. A claim that crosses 72 h while nothing else changes shows as Unattended on the next snapshot push, shell change, or remount. Reduced motion changes nothing here because the marks are static.

**Readout.** Beside the claimant chip, one line names the state: "Working", "Needs you: waiting for approval", "Needs you: awaiting input", "Needs you: turn ended", "Needs you: failed", or "Unattended: no open thread holds this claim" (ticket 07's tooltip carries the claim age). Ticket 06 owns where the line goes. The canvas `role="img"` summary from ticket 05 adds a clause for each non-zero count, for example "1 needs you, 1 unattended", so the state is reachable without the canvas.

**Snapshot.** No change. The snapshot keeps the raw `claimedBy` and `claimedAt` strings from ticket 03. Liveness is client thread data, and the server stays authoritative through the shell stream.

**Vocabulary.** A claimed ticket's **session state** is Working, Needs you, or Unattended. It is derived on the client from the claimant's thread shell and the claim age, and never stored.

**Excluded.** Separate marks for idle versus pending approval or input (the star cannot honestly separate an ended turn that asks a question from a pending prompt, and the readout says which). A separate mark for archived versus unknown claimants (the client cannot see archived shells, and both lead to Release). Subscribing to the archive query to tell them apart. A Failed or usage-limit mark. Reading `pendingGuestMessageCount`. Any animated mark, pulse, or flare on a state change. A timer for the 72 h boundary. Per-ticket moon angles (chartr's `num * 1.3`). Marks scaled with the camera. A third hue. A claimant kind or liveness field in the snapshot. Keeping ticket 12's double claimed ring as a separate fallback.
