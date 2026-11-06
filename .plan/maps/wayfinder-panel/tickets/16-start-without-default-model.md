---
type: grilling
blocked_by: []
undermined_by: []
assets: []
---

# Start thread when the project has no default model

## Question

Spec section 14 has Start resolve the model the way a callerless `t3_thread_launch` does, and that path fails when the server and project settings have no default model (the shipped default is `null`). The build now refuses with an error toast: "The project has no default model. Choose one in Settings, then try again." Should Start instead fall back the way the composer does for a new thread, fall back to the first enabled provider's default model, or keep the refusal and say so in the readout before the click? Decide the behavior, the copy, and whether the MCP `t3_wayfinder_start` path (ticket 06 of `wayfinder-panel-impl`) follows the same rule.

## Done when

The spec's section 14 states the behavior for a missing default model, and `wayfinder-panel-impl` has a ticket or an amendment that builds it.

## Answer

Start falls back the way the composer does for a new thread, decided on the server. When the effective default model is `null`, the server picks the first ready provider instance's default model by the composer's rule, then runs the usage-limit fallback as before. The client-only sticky provider does not apply. One function in `@t3tools/shared/providerModelDefault` holds the rule, and web's composer calls the same function, so the two cannot drift.

When no instance is selectable, Start fails through the existing untyped toast with "No provider is ready. Set one up in Settings, then try again." It is not a typed refusal. The client never branches on it, and a `WayfinderTicketNotStartableError` reason would describe the environment, not the ticket. Start stays enabled before the click, because a client-side check could disagree with the server.

The MCP `t3_wayfinder_start` path does not change. It always launches with the calling thread's model, so a missing project default never reaches it. Callerless `t3_thread_launch` keeps its refusal, because its callers can pass a model.

Excluded: keeping the refusal; a client-resolved `modelSelection` in the RPC payload; a typed error or copy-table row; a disabled Start with reason text; a user-doc change; amending the resolved impl ticket 04.

Built by [Start falls back to the first ready provider](../../wayfinder-panel-impl/tickets/07-start-model-fallback.md). Spec sections 14, 16 and 18 carry the behavior and its checks.
