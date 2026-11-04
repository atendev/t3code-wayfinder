---
type: task
blocked_by: [04]
undermined_by: []
assets: []
---

# Agent start and release through MCP

## Question

Give agents `t3_wayfinder_start` and `t3_wayfinder_release` in `apps/server/src/mcp/toolkits/wayfinder/`. That covers `startsThreads` and `actsAsCaller` access, `readCaller()` first with a refusal when `caller === undefined`, the caller's checkout and project, `clientRequestId` to `commandId`, error mapping to `OrchestratorMcpFailure`, and the optional caller modes and `createdBy: "agent"` stamping on `startTicketThread`. Blocked only by 04, so it can be built beside 05.

Spec sections: [16. Agent access through MCP](../wayfinder-panel/spec.md#16-agent-access-through-mcp), [14. Start thread, claim, and release](../wayfinder-panel/spec.md#14-start-thread-claim-and-release) (the `caller` input), [18. Verification per build ticket](../wayfinder-panel/spec.md#18-verification-per-build-ticket).

## Done when

- Handler tests cover each refusal reason reaching `message`, the callerless refusal, the mode limit reaching `ThreadLaunchService`, and `force` passing through.
- The five `evals/mcp-tool-use/cases/wayfinder.ndjson` cases pass after the toolkit is added to `run.ts`'s imports.
- The `--context` sizes before and after go in the PR body. No UI, so no captures.
- `vp run check:changed` passes, and the PR body has the "Hit every surface" walk and the docs check.
