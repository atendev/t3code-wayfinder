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
