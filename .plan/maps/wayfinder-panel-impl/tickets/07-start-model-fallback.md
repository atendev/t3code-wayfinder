---
type: task
blocked_by: [04]
undermined_by: []
assets: []
---

# Start falls back to the first ready provider

## Question

Make the readout's Start work when the project has no default model. Move the selection parts of `apps/web/src/providerInstances.ts` (entry enablement and availability, picker order, `resolveSelectableProviderInstanceEntry`, `getDefaultProviderInstanceModel`) into a new `@t3tools/shared/providerModelDefault` subpath as one function implementing section 14's four-step rule over `ServerProvider` and settings, with display fields left in web, have web's `resolveProjectDefaultProviderModelSelection` call it, and have `WayfinderMaps` use it when the effective default is `null`, before the usage-limit fallback. The `caller` path is unchanged. When nothing is selectable, the untyped launch error carries the new message. One PR from `main` on `wayfinder/07-start-model-fallback`.

Spec sections: [14. Start thread, claim, and release](../wayfinder-panel/spec.md#14-start-thread-claim-and-release) (launch settings and the missing default model), [16. Agent access through MCP](../wayfinder-panel/spec.md#16-agent-access-through-mcp), [18. Verification per build ticket](../wayfinder-panel/spec.md#18-verification-per-build-ticket).

## Done when

- The section 18 row for 07 holds: the shared table test, web's `providerInstances` tests passing unchanged, and the two `WayfinderMaps` cases.
- The PR has a short runtime transcript of Start on a project with no default model. No captures, since nothing visible changes.
- `vp run check:changed` passes, and the PR body has the "Hit every surface" walk and the docs check.

## Answer

Built as specified. `@t3tools/shared/providerModelDefault` holds the four-step rule behind `resolveProjectDefaultProviderModelSelection`, with a minimal `ProviderSelectionEntry` that web's `ProviderInstanceEntry` extends, so display fields stay in web and web re-exports the moved functions. `WayfinderMaps.launchSettings` uses the rule when the effective default is `null`, before the usage-limit fallback, and a launch with no selectable provider fails through the untyped error with "No provider is ready. Set one up in Settings, then try again." The `caller` path is unchanged. A shared table test and two `WayfinderMaps` cases cover it; web's `providerInstances` tests pass unchanged. Accepted on local checks: CI runs on pull requests only and the fork has no Blacksmith runners. The runtime transcript is not captured.
