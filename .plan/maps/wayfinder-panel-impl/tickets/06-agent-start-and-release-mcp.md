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

## Answer

Built on `wayfinder/06-agent-start-and-release-mcp` in `bafec0af5`.

- `apps/server/src/mcp/toolkits/wayfinder/` holds `t3_wayfinder_start` (`startsThreads`; a linked caller is refused with the spec's text) and `t3_wayfinder_release` (`actsAsCaller`). Both resolve the caller first. They refuse a caller outside a thread with `thread_credential_required`, the code `actsAsCaller` already returns, so both tools agree. They then work in the caller's checkout: its `worktreePath`, else its project's workspace root.
- `startTicketThread` takes an optional `caller` (thread id, model, limited modes, `linkOrigin`). With it the launch uses the caller's model and modes and stamps `createdBy: "agent"`, `creationSource: "mcp"` and `senderThreadId`. Without it the WebSocket path is unchanged. `clientRequestId` derives `commandId` through `launchCommandId`, which moves from the project toolkit into `threadAccess.ts` so both toolkits share it.
- Refusals map to `invalid_request` with section 14's MCP copy. A read failure is `orchestration_error`, and a managed mode ceiling keeps its own message.
- `t3_wayfinder_start` joins `HANDOFF_TOOLS`, so successful starts emit handoff analytics like `t3_thread_launch`. The spec did not say this.
- Tests: the handler tests cover every refusal's message, the callerless refusal, caller modes and model reaching the service, `clientRequestId` replay, and `force` with both checkouts. A `WayfinderMaps` test shows the caller's modes reach `ThreadLaunchService` as an agent launch.
- Evals: `evals/mcp-tool-use/cases/wayfinder.ndjson` has the spec's five cases plus `wayfinder-release-stale-needs-you`, the spec's Needs-you variant. The toolkit is in `run.ts`. All six build in `--dry-run`. They have not been scored, because this checkout has no `ANTHROPIC_API_KEY`.
- `--context`: before, 71 tools, descriptions 15061 chars, schemas 48603 chars. After, 73 tools, 15486 and 49511 chars (+908, about 227 tokens). `agentContextBudget.json` `mcpToolListJsonBytes` goes from 47538 to 48416, so a PR to `main` needs the `agent-context-increase` label.
- `vp run check:changed`: format, lint, knip, typecheck and react compiler pass. The test step fails only in files from the stray `.claude/worktrees/agent-a3fcfba96cac66b45` checkout and in browser tests that need Playwright's Chromium. Every test file on this branch passes. Remote CI did not run: it triggers on pull requests and pushes to `main`, and the fork has no Blacksmith runners.
- Excluded: a model or mode input on `t3_wayfinder_start` (the spec gives none), MCP read tools (section 16), and any `environmentId` forwarding.
