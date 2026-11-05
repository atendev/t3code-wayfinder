import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  type Project as ProjectRecord,
  ThreadId,
  WayfinderClaimLiveError,
  WayfinderTicketNotFoundError,
  WayfinderTicketNotStartableError,
  type WayfinderReleaseClaimInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as WayfinderMaps from "../../../wayfinder/WayfinderMaps.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as WayfinderHandlers from "./handlers.ts";
import { WayfinderToolkit } from "./tools.ts";

const callerId = ThreadId.make("thread:wayfinder-caller");

const harness = (options: {
  readonly inThread?: false;
  readonly worktreePath?: string;
  readonly runtimeMode?: "auto-accept-edits" | "full-access";
  readonly interactionMode?: "plan" | "default";
  readonly startRefusal?: WayfinderTicketNotStartableError;
  readonly releaseRefusal?: WayfinderClaimLiveError | WayfinderTicketNotFoundError;
}) => {
  const starts: Array<WayfinderMaps.WayfinderStartTicketThreadServiceInput> = [];
  const releases: Array<WayfinderReleaseClaimInput> = [];
  const shell = {
    ...liveThreadShell(callerId, {
      ...(options.runtimeMode === undefined ? {} : { runtimeMode: options.runtimeMode }),
      ...(options.interactionMode === undefined
        ? {}
        : { interactionMode: options.interactionMode }),
    }),
    worktreePath: options.worktreePath ?? null,
  };
  const dependencies = Layer.mergeAll(
    NodeCrypto.layer,
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment"),
      requestNamespace: "provider:wayfinder",
      thread:
        options.inThread === false
          ? undefined
          : {
              threadId: callerId,
              providerSessionId: "provider:wayfinder",
              providerInstanceId: ProviderInstanceId.make("codex"),
            },
      client:
        options.inThread === false
          ? { sessionId: "session-1", label: "Claude Code", access: "full-access" }
          : undefined,
      capabilities: new Set(["orchestration" as const]),
      issuedAt: 0,
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () => Effect.succeed(shell),
    }),
    Layer.mock(Project.ProjectService)({
      getById: (projectId) =>
        Effect.succeedSome({
          id: projectId,
          workspaceRoot: "/home/user/app",
        } as unknown as ProjectRecord),
    }),
    Layer.mock(WayfinderMaps.WayfinderMaps)({
      startTicketThread: (input) => {
        starts.push(input);
        return options.startRefusal === undefined
          ? Effect.succeed({
              threadId: ThreadId.make(input.commandId),
              ticketPath: ".plan/maps/onboarding/tickets/05-invite-flow.md",
            })
          : Effect.fail(options.startRefusal);
      },
      releaseClaim: (input) => {
        releases.push(input);
        return options.releaseRefusal === undefined
          ? Effect.succeed({ released: true })
          : Effect.fail(options.releaseRefusal);
      },
    }),
  );
  const provideHandlers = Effect.provide(
    McpToolAccess.HandlersLayer.layer(WayfinderHandlers.layer).pipe(
      Layer.provideMerge(dependencies),
    ),
  );
  const start = (params: {
    readonly mapSlug: string;
    readonly number: number;
    readonly clientRequestId?: string;
  }) =>
    WayfinderToolkit.pipe(
      Effect.flatMap((toolkit) => toolkit.handle("t3_wayfinder_start", params)),
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((results) => results.at(-1)?.result),
      provideHandlers,
    );
  const release = (params: {
    readonly mapSlug: string;
    readonly number: number;
    readonly force?: boolean;
  }) =>
    WayfinderToolkit.pipe(
      Effect.flatMap((toolkit) => toolkit.handle("t3_wayfinder_release", params)),
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((results) => results.at(-1)?.result),
      provideHandlers,
    );
  return { start, release, starts, releases };
};

it.effect("each refusal reaches the agent as the MCP copy in message", () =>
  Effect.gen(function* () {
    const startCases: ReadonlyArray<readonly [WayfinderTicketNotStartableError, string]> = [
      [
        new WayfinderTicketNotStartableError({
          mapSlug: "onboarding",
          number: 5,
          reason: "missing",
        }),
        "Ticket 05 of the onboarding map does not exist.",
      ],
      [
        new WayfinderTicketNotStartableError({
          mapSlug: "onboarding",
          number: 5,
          reason: "resolved",
        }),
        "Ticket 05 is already resolved.",
      ],
      [
        new WayfinderTicketNotStartableError({
          mapSlug: "onboarding",
          number: 5,
          reason: "out-of-scope",
        }),
        "Ticket 05 is out of scope.",
      ],
      [
        new WayfinderTicketNotStartableError({
          mapSlug: "onboarding",
          number: 5,
          reason: "claimed",
          claimedBy: "thread:other",
        }),
        "Ticket 05 is already claimed by thread thread:other.",
      ],
      [
        new WayfinderTicketNotStartableError({
          mapSlug: "onboarding",
          number: 5,
          reason: "blocked",
          blockers: [3, 5],
        }),
        "Ticket 05 is blocked by 03, 05. Resolve those first.",
      ],
      [
        new WayfinderTicketNotStartableError({
          mapSlug: "onboarding",
          number: 5,
          reason: "problem",
        }),
        "Ticket 05 has a frontmatter problem. Fix the file first.",
      ],
    ];
    const releaseCases: ReadonlyArray<
      readonly [WayfinderClaimLiveError | WayfinderTicketNotFoundError, string]
    > = [
      [
        new WayfinderClaimLiveError({ number: 7, state: "working", threadId: "thread:other" }),
        "Ticket 07's claim is held by thread thread:other, which is working. Pass force: true only if the user asked.",
      ],
      [
        new WayfinderClaimLiveError({ number: 7, state: "needs-you", threadId: "thread:other" }),
        "Ticket 07's claim is held by thread thread:other, which is waiting on the user. Pass force: true only if the user asked.",
      ],
      [
        new WayfinderTicketNotFoundError({ mapSlug: "onboarding", number: 7 }),
        "Ticket 07 of the onboarding map does not exist.",
      ],
    ];
    for (const [startRefusal, message] of startCases) {
      const { start } = harness({ startRefusal });
      const result = yield* start({ mapSlug: "onboarding", number: 5 });
      expect(result).toMatchObject({ code: "invalid_request", message });
    }
    for (const [releaseRefusal, message] of releaseCases) {
      const { release } = harness({ releaseRefusal });
      const result = yield* release({ mapSlug: "onboarding", number: 7 });
      expect(result).toMatchObject({ code: "invalid_request", message });
    }
  }),
);

it.effect("a caller outside a thread is refused before the service runs", () =>
  Effect.gen(function* () {
    const { start, release, starts, releases } = harness({ inThread: false });
    expect(yield* start({ mapSlug: "onboarding", number: 5 })).toMatchObject({
      code: "thread_credential_required",
    });
    expect(yield* release({ mapSlug: "onboarding", number: 5 })).toMatchObject({
      code: "thread_credential_required",
    });
    expect(starts).toHaveLength(0);
    expect(releases).toHaveLength(0);
  }),
);

it.effect("start runs in the caller's checkout with its model and its limited modes", () =>
  Effect.gen(function* () {
    const { start, starts } = harness({
      worktreePath: "/home/user/app-worktrees/invite",
      runtimeMode: "auto-accept-edits",
      interactionMode: "plan",
    });
    const result = yield* start({ mapSlug: "onboarding", number: 5, clientRequestId: "start-05" });
    const retried = yield* start({ mapSlug: "onboarding", number: 5, clientRequestId: "start-05" });
    const shell = liveThreadShell(callerId);
    expect(starts[0]).toMatchObject({
      cwd: "/home/user/app-worktrees/invite",
      projectId: shell.projectId,
      caller: {
        threadId: callerId,
        modelSelection: shell.modelSelection,
        runtimeMode: "auto-accept-edits",
        interactionMode: "plan",
      },
    });
    expect(starts[1]?.commandId).toBe(starts[0]?.commandId);
    expect(result).toMatchObject({
      threadId: starts[0]?.commandId,
      link: `<t3-thread://v2/environment/${starts[0]?.commandId}>`,
      ticketPath: ".plan/maps/onboarding/tickets/05-invite-flow.md",
    });
    expect(retried).toEqual(result);
  }),
);

it.effect("release runs in the caller's checkout and passes force through", () =>
  Effect.gen(function* () {
    const inRoot = harness({});
    yield* inRoot.release({ mapSlug: "onboarding", number: 7 });
    yield* inRoot.release({ mapSlug: "onboarding", number: 7, force: true });
    const inWorktree = harness({ worktreePath: "/home/user/app-worktrees/invite" });
    yield* inWorktree.release({ mapSlug: "onboarding", number: 7 });
    expect([...inRoot.releases, ...inWorktree.releases]).toEqual([
      { cwd: "/home/user/app", mapSlug: "onboarding", number: 7 },
      { cwd: "/home/user/app", mapSlug: "onboarding", number: 7, force: true },
      { cwd: "/home/user/app-worktrees/invite", mapSlug: "onboarding", number: 7 },
    ]);
  }),
);
