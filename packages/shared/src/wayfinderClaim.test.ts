import { describe, expect, it } from "vite-plus/test";

import { type ClaimantThread, claimSessionState } from "./wayfinderClaim.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const RECENT = "2026-11-04T11:00:00Z";
const OLD = "2026-11-01T11:59:59Z";

const thread = (overrides: Partial<ClaimantThread> = {}): ClaimantThread => ({
  archived: false,
  runtimeStatus: "idle",
  pendingRequest: null,
  ...overrides,
});

describe("claimSessionState", () => {
  it.each([
    ["a missing thread", null, RECENT, { state: "unattended", reason: "no_thread" }],
    [
      "an archived thread",
      thread({ archived: true, runtimeStatus: "running" }),
      RECENT,
      { state: "unattended", reason: "no_thread" },
    ],
    [
      "a pending approval, even while running",
      thread({ runtimeStatus: "running", pendingRequest: "approval" }),
      RECENT,
      { state: "needs-you", reason: "approval" },
    ],
    [
      "pending user input",
      thread({ pendingRequest: "input" }),
      OLD,
      { state: "needs-you", reason: "input" },
    ],
    [
      "a pending subagent request",
      thread({ pendingRequest: "subagent" }),
      RECENT,
      { state: "needs-you", reason: "input" },
    ],
    ["a running thread", thread({ runtimeStatus: "running" }), RECENT, { state: "working" }],
    [
      "a thread waiting on another",
      thread({ runtimeStatus: "waiting" }),
      OLD,
      { state: "working" },
    ],
    ["a queued thread", thread({ runtimeStatus: "queued" }), RECENT, { state: "working" }],
    [
      "an idle thread over 72 h",
      thread({ runtimeStatus: "idle" }),
      OLD,
      { state: "unattended", reason: "aged" },
    ],
    [
      "a completed turn",
      thread({ runtimeStatus: "completed" }),
      RECENT,
      { state: "needs-you", reason: "turn_ended" },
    ],
    [
      "a thread with no runtime",
      thread({ runtimeStatus: null }),
      RECENT,
      { state: "needs-you", reason: "turn_ended" },
    ],
    [
      "a failed turn",
      thread({ runtimeStatus: "failed" }),
      RECENT,
      { state: "needs-you", reason: "failed" },
    ],
    [
      "an unparseable claim time, never aged",
      thread({ runtimeStatus: "idle" }),
      "last tuesday",
      { state: "needs-you", reason: "turn_ended" },
    ],
    [
      "exactly 72 h, not yet aged",
      thread({ runtimeStatus: "idle" }),
      "2026-11-01T12:00:00Z",
      { state: "needs-you", reason: "turn_ended" },
    ],
  ] as const)("reads %s", (_name, claimant, claimedAt, expected) => {
    expect(claimSessionState(claimant, claimedAt, NOW)).toEqual(expected);
  });
});
