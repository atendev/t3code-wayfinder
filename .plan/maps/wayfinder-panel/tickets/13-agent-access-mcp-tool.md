---
type: grilling
blocked_by: [03]
undermined_by: []
assets: []
---

# Agent access to maps through MCP

## Question

Ticket 03 made `WayfinderMaps` a service with `getSnapshot`, `readTicket`, and `readMap`. Should agents reach those methods through T3 Code MCP tools rather than by reading `.plan/` files, and if so, which tools: one snapshot tool, or separate snapshot and ticket tools? What does each return to a model (the full snapshot schema, or a trimmed frontier-first view), which scope gates it, and does it change what the `/wayfinder` skill tells agents to do? Model-facing tool text falls under `evals/README.md`.

## Done when

The answer either rules MCP access out with the reason, or names each tool, its input, its returned shape, its scope, the eval cases that cover its description, and any change to the skill text.

## Answer

Decided on 2026-11-04 by a subagent standing in for the user, at the user's request, after a self-run grilling round.

**Reads stay on files.** No MCP tool exposes `getSnapshot`, `readTicket`, or `readMap`. A T3 agent runs on the environment's machine with the checkout as its working directory, so its own file tools read the same bytes the service parses, and the frontier follows from two rules in `.plan/README.md`. The snapshot is shaped for the panel (fingerprints, problems, renderer summaries); a trimmed model-facing copy would be a second contract to keep in sync. A read tool would only help an agent reading a linked environment's maps, which nobody has asked for, and every tool description costs context on every turn of every thread.

**Writes get tools.** Starting a ticket thread and releasing a claim are user capabilities that an agent cannot do correctly with file tools: `.plan/README.md` forbids agents from writing `claimed_by`, and the claim must be taken under the per-root lock before launch. Both get MCP tools in a new `apps/server/src/mcp/toolkits/wayfinder/`. Each handler decodes input, calls one `WayfinderMaps` method, and maps its errors to `OrchestratorMcpFailure` with the typed reason (blocked by 03, claimed by a live thread, a frontmatter problem) in `message`.

- **`t3_wayfinder_start`**, declared `actsAsCaller`: it needs a calling thread and a read-write MCP client. No `environmentId`, so linked-environment forwarding never applies.
  - Input: `{ mapSlug, number, clientRequestId? }`. Checkout and project come from the caller's thread, matching the panel's active-checkout rule. `clientRequestId` derives `commandId`, so a retry replays rather than creating a second thread.
  - Returns: `{ threadId, link, ticketPath }`.
  - Annotations: `Destructive`, `OpenWorld`.
  - Draft description: "Start a new thread on one Wayfinder ticket in this thread's checkout and claim the ticket for it. Frontier tickets only: open, unclaimed, every blocker resolved. Not for working a ticket yourself; read its file. After an error or lost reply, retry with the same `clientRequestId`. Mention the thread with its `link`."
- **`t3_wayfinder_release`**, declared `actsAsCaller`.
  - Input: `{ mapSlug, number, force? }`.
  - Returns: `{ released: boolean }`, `false` when the ticket had no claim.
  - Refuses a claim held by a live, unarchived T3 thread unless `force: true`, the `t3_project_delete` pattern. This stands in for the readout's confirm.
  - Annotations: `Destructive`, `Idempotent`.
  - Draft description: "Clear a Wayfinder ticket's claim. A claim held by a live thread needs `force: true`."

**Scope.** MCP tools have no per-RPC auth scopes. The gate is the client's access level (`actsAsCaller` refuses read-only clients) plus the thread-caller requirement. The service still runs `KnownWorkspaces.assertContains` before any write.

**Amendment to ticket 07.** `WayfinderMaps.startTicketThread` takes an optional `{ modelSelection, runtimeMode }`. The WebSocket path omits it and gets project defaults as before. The MCP handler passes the caller's inherited model and runtime mode, as `t3_thread_launch` does, so an agent cannot start a ticket thread above its own mode ceiling. That ceiling is enforced in the MCP launch handler today, not in `ThreadLaunchService`, so calling the service directly would skip it.

**Evals.** New `evals/mcp-tool-use/cases/wayfinder.ndjson` with authored Acme data (an `acme/app` checkout and an `onboarding` map); each case names this ticket as its `source`. Check context size with the `--context` run before and after.

1. `wayfinder-start-claims` (guard). "Start a thread on ticket 05 of the onboarding map." Expects `t3_wayfinder_start` with `{ mapSlug: "onboarding", number: 5 }`. Must not call `t3_thread_launch` or write `claimed_by`/`claimed_at` into the file.
2. `wayfinder-start-refused-blocked` (guard). The mock returns "blocked by 03". The agent reports the blocker. Must not call `t3_thread_launch`, edit frontmatter, or try another number nobody asked for.
3. `wayfinder-release-stale` (guard). "Ticket 07's claim is stale, free it." Expects `t3_wayfinder_release`; must not edit `claimed_by` by hand. When the mock refuses because the claimant is live, must not retry with `force: true` unless the user said to.
4. `wayfinder-work-own-ticket` (control). The prompt is ticket 07's start prompt (`$wayfinder Work ticket 05 of the onboarding map: …`). The agent reads `map.md` and the ticket; must not call `t3_wayfinder_start`, which would spawn a duplicate thread.
5. `wayfinder-frontier-question` (control). "What's next on the onboarding map?" The agent reads files and answers; must not call either tool.

**Skill text.** No change. The local skill defers claim mechanics to `.plan/README.md` (Pull the upstream wayfinder text changes into the local skill), and the rule that agents never write `claimed_by` still holds because the tool writes it. Agents find the tools through their descriptions.

**Excluded.** Snapshot, ticket, and map read tools, and a trimmed frontier-first view. A tool that claims a ticket for the calling thread; threads users start themselves stay unclaimed. `environmentId` and linked-environment forwarding. Callers outside a thread. A `cwd` parameter. Any change to the skill or `.plan/README.md`.
