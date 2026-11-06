import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ThreadShellSnapshot,
  type ModelSelection,
  type Project,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import type { RootSnapshot } from "./parse.ts";
import * as WayfinderClaimReactor from "./WayfinderClaimReactor.ts";
import * as WayfinderMaps from "./WayfinderMaps.ts";

const snapshotTitled = (title: string): RootSnapshot => ({
  root: "/repo",
  maps: [{ slug: "panel", title, fingerprint: title, tickets: [], frontier: [], problems: [] }],
  problems: [],
});

const withTicketProblem = (snapshot: RootSnapshot, title: string): RootSnapshot => ({
  ...snapshot,
  maps: snapshot.maps.map((map) => ({
    ...map,
    frontier: title === "broken" ? [] : [1],
    tickets: [
      {
        number: 1,
        slug: "one",
        title,
        type: "task",
        status: "open",
        frontier: title !== "broken",
        blockedBy: [],
        underminedBy: [],
        assets: [],
        claimedBy: null,
        claimedAt: null,
        fingerprint: title,
        problems:
          title === "broken"
            ? [{ path: ".plan/maps/panel/tickets/01-one.md", reason: "missing-frontmatter" }]
            : [],
      },
    ],
  })),
});

/** A watcher whose change signal and reads the test drives. */
const scriptedWatcher = Effect.fn(function* (initial: RootSnapshot) {
  const signals = yield* Queue.unbounded<void>();
  const reads = yield* Queue.unbounded<RootSnapshot>();
  const onDisk = yield* Ref.make(initial);
  const watcher = yield* WayfinderMaps.makeRootWatcher({
    changes: (onReady) => Stream.fromQueue(signals).pipe(Stream.onStart(Effect.sync(onReady))),
    read: Ref.get(onDisk).pipe(Effect.tap((snapshot) => Queue.offer(reads, snapshot))),
  });
  yield* Queue.take(reads);
  const pushes = yield* Queue.unbounded<RootSnapshot>();
  yield* watcher.changes.pipe(
    Stream.runForEach((snapshot) => Queue.offer(pushes, snapshot)),
    Effect.forkScoped,
  );
  expect(yield* Queue.take(pushes)).toEqual(initial);
  return {
    signal: Queue.offer(signals, undefined),
    write: (snapshot: RootSnapshot) => Ref.set(onDisk, snapshot),
    reads,
    pushes,
  };
});

describe("makeRootWatcher", () => {
  it.effect("merges changes inside the 250 ms debounce into one read and one push", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watcher = yield* scriptedWatcher(snapshotTitled("A"));
        yield* watcher.write(snapshotTitled("B"));
        yield* watcher.signal;
        yield* TestClock.adjust("100 millis");
        yield* watcher.signal;
        yield* TestClock.adjust("249 millis");
        expect(yield* Queue.size(watcher.reads)).toBe(0);
        yield* TestClock.adjust("1 millis");
        expect(yield* Queue.take(watcher.reads)).toEqual(snapshotTitled("B"));
        expect(yield* Queue.take(watcher.pushes)).toEqual(snapshotTitled("B"));
        expect(yield* Queue.size(watcher.reads)).toBe(0);
      }),
    ),
  );

  it.effect("skips publishing a snapshot equal to the last one", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watcher = yield* scriptedWatcher(snapshotTitled("A"));
        yield* watcher.signal;
        yield* TestClock.adjust("250 millis");
        yield* Queue.take(watcher.reads);
        yield* watcher.write(snapshotTitled("B"));
        yield* watcher.signal;
        yield* TestClock.adjust("250 millis");
        yield* Queue.take(watcher.reads);
        // The unchanged read published nothing, so the next push is the change.
        expect(yield* Queue.take(watcher.pushes)).toEqual(snapshotTitled("B"));
      }),
    ),
  );

  it.effect("holds a ticket that gains a problem and re-reads once after 500 ms", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clean = withTicketProblem(snapshotTitled("A"), "clean");
        const watcher = yield* scriptedWatcher(clean);
        const broken = withTicketProblem(snapshotTitled("B"), "broken");
        yield* watcher.write(broken);
        yield* watcher.signal;
        yield* TestClock.adjust("250 millis");
        yield* Queue.take(watcher.reads);
        // The map change lands at once; the ticket keeps its previous summary.
        expect(yield* Queue.take(watcher.pushes)).toEqual({
          ...broken,
          maps: [{ ...broken.maps[0]!, tickets: clean.maps[0]!.tickets, frontier: [1] }],
        });
        yield* TestClock.adjust("499 millis");
        expect(yield* Queue.size(watcher.reads)).toBe(0);
        yield* TestClock.adjust("1 millis");
        yield* Queue.take(watcher.reads);
        expect(yield* Queue.take(watcher.pushes)).toEqual(broken);
      }),
    ),
  );
});

const PROJECT_ID = ProjectId.make("project");

interface LaunchStubs {
  readonly launch?: ThreadLaunch.ThreadLaunchService["Service"]["launch"];
  readonly shells?: ReadonlyMap<string, OrchestrationV2ThreadShell>;
  readonly listed?: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly events?: Stream.Stream<OrchestrationV2DomainEvent>;
  readonly defaultModelSelection?: ModelSelection | null;
  readonly providers?: ReadonlyArray<ServerProvider>;
}

const layerServiceStubs = (stubs: LaunchStubs = {}) =>
  Layer.mergeAll(
    Layer.mock(KnownWorkspaces.KnownWorkspaces)({ assertContains: () => Effect.void }),
    Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({ detect: () => Effect.succeed(null) }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch:
        stubs.launch ??
        ((input) =>
          Effect.succeed({
            threadId: input.threadId!,
            resumed: false,
          } as ThreadLaunch.ThreadLaunchResult)),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadShell: (threadId) => Effect.succeed(stubs.shells?.get(threadId) ?? null),
      getShellSnapshot: () =>
        Effect.succeed({ threads: stubs.listed ?? [] } as OrchestrationV2ThreadShellSnapshot),
      streamDomainEvents: stubs.events ?? Stream.empty,
    }),
    Layer.mock(ProjectService.ProjectService)({
      getById: () => Effect.succeedSome({ id: PROJECT_ID, workspaceRoot: "/elsewhere" } as Project),
    }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed({
        ...DEFAULT_SERVER_SETTINGS,
        defaultModelSelection:
          stubs.defaultModelSelection === undefined
            ? { instanceId: ProviderInstanceId.make("replay"), model: "replay" }
            : stubs.defaultModelSelection,
      }),
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Effect.succeed(stubs.providers ?? []),
    }),
  );
const layerWorkspaceStubs = layerServiceStubs();

describe("WayfinderMaps", () => {
  it.effect("stops a root's watcher 30 s after its last subscriber leaves", () =>
    Effect.gen(function* () {
      const watching = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const fileSystem = FileSystem.layerNoop({
        exists: () => Effect.succeed(false),
        watch: (_path, options) =>
          Stream.never.pipe(
            Stream.onStart(
              Effect.andThen(
                Effect.sync(() => options?.onReady?.()),
                Deferred.succeed(watching, undefined),
              ),
            ),
            Stream.ensuring(Deferred.succeed(released, undefined)),
          ),
      });
      yield* Effect.gen(function* () {
        const maps = yield* WayfinderMaps.WayfinderMaps;
        const pushes = yield* Queue.unbounded<string>();
        const subscriber = yield* maps.streamSnapshots("/repo").pipe(
          Stream.runForEach((snapshot) => Queue.offer(pushes, snapshot.root)),
          Effect.forkChild,
        );
        yield* Deferred.await(watching);
        expect(yield* Queue.take(pushes)).toBe("/repo");
        yield* Fiber.interrupt(subscriber);
        yield* TestClock.adjust("29 seconds");
        expect(yield* Deferred.isDone(released)).toBe(false);
        yield* TestClock.adjust("1 second");
        yield* Deferred.await(released);
      }).pipe(
        Effect.provide(
          WayfinderMaps.layer.pipe(
            Layer.provide(layerWorkspaceStubs),
            Layer.provide(Layer.merge(fileSystem, Path.layer)),
          ),
        ),
      );
    }),
  );

  const layerOnDisk = WayfinderMaps.layer.pipe(
    Layer.provide(layerWorkspaceStubs),
    Layer.provideMerge(NodeServices.layer),
  );

  const writeMap = Effect.fn(function* (root: string) {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(`${root}/.plan/maps/panel/tickets`, { recursive: true });
    yield* fs.writeFileString(
      `${root}/.plan/maps/panel/map.md`,
      "# Panel\n\n## Destination\n\nShip.\n",
    );
  });

  it.live("pushes a snapshot after a real ticket write", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped();
        yield* writeMap(root);
        const maps = yield* WayfinderMaps.WayfinderMaps;
        const pushes = yield* Queue.unbounded<ReadonlyArray<number>>();
        yield* maps.streamSnapshots(root).pipe(
          Stream.runForEach((snapshot) => Queue.offer(pushes, snapshot.maps[0]?.frontier ?? [])),
          Effect.forkScoped,
        );
        expect(yield* Queue.take(pushes)).toEqual([]);
        yield* fs.writeFileString(
          `${root}/.plan/maps/panel/tickets/01-first.md`,
          "---\ntype: task\n---\n# First\n\n## Question\n\nq\n\n## Done when\n\nd\n",
        );
        expect(yield* Queue.take(pushes)).toEqual([1]);
      }),
    ).pipe(Effect.provide(layerOnDisk)),
  );

  it.effect("reads a ticket and its map by slug and number only", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped();
        yield* writeMap(root);
        yield* fs.writeFileString(
          `${root}/.plan/maps/panel/tickets/01-first.md`,
          "---\ntype: task\n---\n# First\n\n## Question\n\nWhy?\n",
        );
        const maps = yield* WayfinderMaps.WayfinderMaps;
        const snapshot = yield* maps.getSnapshot(root);

        const ticket = yield* maps.readTicket({ cwd: root, mapSlug: "panel", number: 1 });
        expect(ticket).toEqual({
          fingerprint: snapshot.maps[0]!.tickets[0]!.fingerprint,
          title: "First",
          sections: [{ heading: "Question", markdown: "Why?" }],
        });
        expect((yield* maps.readMap({ cwd: root, mapSlug: "panel" })).fingerprint).toBe(
          snapshot.maps[0]!.fingerprint,
        );
        for (const input of [
          { cwd: root, mapSlug: "panel", number: 2 },
          { cwd: root, mapSlug: "../panel", number: 1 },
        ]) {
          const error = yield* maps.readTicket(input).pipe(Effect.flip);
          expect(error._tag).toBe("WayfinderTicketNotFoundError");
        }
      }),
    ).pipe(Effect.provide(layerOnDisk)),
  );
});

const TICKET = (frontmatter: string) =>
  `---\n${frontmatter}---\n# Ticket\n\n## Question\n\nq\n\n## Done when\n\nd\n`;

const writeTickets = Effect.fn(function* (root: string, tickets: Record<string, string>) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(`${root}/.plan/maps/panel/tickets`, { recursive: true });
  yield* fs.writeFileString(
    `${root}/.plan/maps/panel/map.md`,
    "# Panel\n\n## Destination\n\nShip.\n",
  );
  for (const [name, text] of Object.entries(tickets)) {
    yield* fs.writeFileString(`${root}/.plan/maps/panel/tickets/${name}`, text);
  }
});

const readyProvider = (driver: string, instanceId: string, model: string) =>
  ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    status: "ready",
    models: [{ slug: model, name: model, isCustom: false, capabilities: {} }],
  }) as unknown as ServerProvider;

const readTicketFile = (root: string, name: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(`${root}/.plan/maps/panel/tickets/${name}`)),
  );

const startInput = (root: string, number: number, commandId: string) => ({
  cwd: root,
  projectId: PROJECT_ID,
  mapSlug: "panel",
  number,
  commandId: CommandId.make(commandId),
});

const shellWith = (overrides: Partial<OrchestrationV2ThreadShell>) =>
  ({
    deletedAt: null,
    archivedAt: null,
    latestRunId: "run",
    activeProviderThreadId: null,
    pendingBackgroundTasks: [],
    status: "completed",
    pendingRuntimeRequest: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "holder" },
    ...overrides,
  }) as OrchestrationV2ThreadShell;

const withMaps = <A, E>(
  stubs: LaunchStubs,
  program: (
    root: string,
  ) => Effect.Effect<A, E, WayfinderMaps.WayfinderMaps | FileSystem.FileSystem>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      return yield* program(root);
    }),
  ).pipe(
    Effect.provide(
      WayfinderMaps.layer.pipe(
        Layer.provide(layerServiceStubs(stubs)),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

describe("WayfinderMaps.startTicketThread", () => {
  it.effect("lets one of two concurrent starts claim the ticket", () =>
    withMaps({}, (root) =>
      Effect.gen(function* () {
        yield* writeTickets(root, { "01-one.md": TICKET("type: task\nblocked_by: []\n") });
        const maps = yield* WayfinderMaps.WayfinderMaps;
        const [first, second] = yield* Effect.all(
          [
            Effect.exit(maps.startTicketThread(startInput(root, 1, "command-a"))),
            Effect.exit(maps.startTicketThread(startInput(root, 1, "command-b"))),
          ],
          { concurrency: "unbounded" },
        );
        const exits = [first, second];
        expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
        const refusal = exits.find(Exit.isFailure);
        expect(refusal && Exit.isFailure(refusal) ? refusal.cause.toString() : "").toContain(
          "WayfinderTicketNotStartableError",
        );
        const text = yield* readTicketFile(root, "01-one.md");
        expect(text.match(/claimed_by:/g)).toHaveLength(1);
        expect(text).toContain("type: task\nblocked_by: []\nclaimed_by: command-");
      }),
    ),
  );

  it.effect("strips the claim when launch fails before the thread exists", () =>
    withMaps(
      {
        launch: (input) =>
          Effect.fail(
            new ThreadLaunch.ThreadLaunchError({
              operation: "resolve-project",
              commandId: input.commandId,
              projectId: input.projectId,
              cause: new Error("boom"),
            }),
          ),
      },
      (root) =>
        Effect.gen(function* () {
          const original = TICKET("type: task\n");
          yield* writeTickets(root, { "01-one.md": original });
          const maps = yield* WayfinderMaps.WayfinderMaps;
          const error = yield* maps
            .startTicketThread(startInput(root, 1, "command-a"))
            .pipe(Effect.flip);
          expect(error._tag).toBe("ThreadLaunchError");
          expect(yield* readTicketFile(root, "01-one.md")).toBe(original);
        }),
    ),
  );

  it.effect("launches on the first ready provider's default model when the default is null", () =>
    Effect.gen(function* () {
      const launched = yield* Deferred.make<ModelSelection>();
      yield* withMaps(
        {
          defaultModelSelection: null,
          providers: [readyProvider("claudeAgent", "claudeAgent", "sonnet")],
          launch: (input) =>
            Deferred.succeed(launched, input.modelSelection!).pipe(
              Effect.as({
                threadId: input.threadId!,
                resumed: false,
              } as ThreadLaunch.ThreadLaunchResult),
            ),
        },
        (root) =>
          Effect.gen(function* () {
            yield* writeTickets(root, { "01-one.md": TICKET("type: task\n") });
            const maps = yield* WayfinderMaps.WayfinderMaps;
            yield* maps.startTicketThread(startInput(root, 1, "command-a"));
          }),
      );
      expect(yield* Deferred.await(launched)).toEqual({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "sonnet",
      });
    }),
  );

  it.effect("fails with the no-provider message and leaves no claim when none is selectable", () =>
    withMaps({ defaultModelSelection: null, providers: [] }, (root) =>
      Effect.gen(function* () {
        const original = TICKET("type: task\n");
        yield* writeTickets(root, { "01-one.md": original });
        const maps = yield* WayfinderMaps.WayfinderMaps;
        const error = yield* maps
          .startTicketThread(startInput(root, 1, "command-a"))
          .pipe(Effect.flip);
        expect(String(error.cause)).toContain(
          "No provider is ready. Set one up in Settings, then try again.",
        );
        expect(yield* readTicketFile(root, "01-one.md")).toBe(original);
      }),
    ),
  );

  it.effect("replays a retried commandId instead of refusing its own claim", () =>
    withMaps({}, (root) =>
      Effect.gen(function* () {
        yield* writeTickets(root, { "01-one.md": TICKET("type: task\n") });
        const maps = yield* WayfinderMaps.WayfinderMaps;
        const first = yield* maps.startTicketThread(startInput(root, 1, "command-a"));
        const claimed = yield* readTicketFile(root, "01-one.md");
        const retry = yield* maps.startTicketThread(startInput(root, 1, "command-a"));
        expect(retry).toEqual(first);
        expect(first).toEqual({
          threadId: ThreadId.make("command-a"),
          ticketPath: ".plan/maps/panel/tickets/01-one.md",
        });
        expect(yield* readTicketFile(root, "01-one.md")).toBe(claimed);
      }),
    ),
  );

  it.effect(
    "launches an agent caller's start with its model and limited modes, as the agent",
    () => {
      const launched: Array<ThreadLaunch.ThreadLaunchInput> = [];
      const callerModel = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-caller" };
      return withMaps(
        {
          launch: (input) => {
            launched.push(input);
            return Effect.succeed({
              threadId: input.threadId!,
              resumed: false,
            } as ThreadLaunch.ThreadLaunchResult);
          },
        },
        (root) =>
          Effect.gen(function* () {
            yield* writeTickets(root, { "01-one.md": TICKET("type: task\n") });
            const maps = yield* WayfinderMaps.WayfinderMaps;
            yield* maps.startTicketThread({
              ...startInput(root, 1, "command-a"),
              caller: {
                threadId: ThreadId.make("thread:caller"),
                modelSelection: callerModel,
                runtimeMode: "auto-accept-edits",
                interactionMode: "plan",
              },
            });
            expect(launched[0]).toMatchObject({
              modelSelection: callerModel,
              runtimeMode: "auto-accept-edits",
              interactionMode: "plan",
              createdBy: "agent",
              creationSource: "mcp",
              initialMessage: { senderThreadId: "thread:caller" },
            });
          }),
      );
    },
  );

  it.effect("names the unresolved blockers of a ticket off the frontier", () =>
    withMaps({}, (root) =>
      Effect.gen(function* () {
        yield* writeTickets(root, {
          "01-one.md": TICKET("type: task\n"),
          "02-two.md": TICKET("type: task\nblocked_by: [01, 03]\n"),
        });
        const maps = yield* WayfinderMaps.WayfinderMaps;
        const error = yield* maps
          .startTicketThread(startInput(root, 2, "command-a"))
          .pipe(Effect.flip);
        expect(error).toMatchObject({ reason: "blocked", blockers: [1, 3] });
      }),
    ),
  );
});

describe("WayfinderMaps.releaseClaim", () => {
  const claimed = TICKET("type: task\nclaimed_by: holder\nclaimed_at: 1970-01-01T00:00:00Z\n");

  it.effect.each([
    ["working", shellWith({ status: "running" })],
    ["needs-you", shellWith({ status: "completed" })],
  ] as const)("refuses an unforced release while the claimant is %s", ([state, shell]) =>
    withMaps({ shells: new Map([["holder", shell]]) }, (root) =>
      Effect.gen(function* () {
        yield* writeTickets(root, { "01-one.md": claimed });
        const maps = yield* WayfinderMaps.WayfinderMaps;
        const error = yield* maps
          .releaseClaim({ cwd: root, mapSlug: "panel", number: 1 })
          .pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "WayfinderClaimLiveError", state, threadId: "holder" });
        expect(yield* readTicketFile(root, "01-one.md")).toBe(claimed);
        expect(
          yield* maps.releaseClaim({ cwd: root, mapSlug: "panel", number: 1, force: true }),
        ).toEqual({ released: true });
        expect(yield* readTicketFile(root, "01-one.md")).toBe(TICKET("type: task\n"));
      }),
    ),
  );

  it.effect.each([
    ["refuses while a live subagent awaits approval", true, "running"],
    ["releases with no subagent request", false, "running"],
    ["releases past a finished subagent's stale request", true, "completed"],
    ["refuses while a side chat asks the user", true, "side-chat"],
  ] as const)("%s", ([_name, pending, childStatus]) => {
    const aged = TICKET("type: task\nclaimed_by: holder\nclaimed_at: 1969-12-01T00:00:00Z\n");
    const holder = shellWith({ id: ThreadId.make("holder"), status: "completed" });
    const child = shellWith({
      id: ThreadId.make("child"),
      status: childStatus === "completed" ? "completed" : "running",
      lineage:
        childStatus === "side-chat"
          ? { parentThreadId: "holder", relationshipToParent: null, sideChat: true }
          : { parentThreadId: "holder", relationshipToParent: "subagent", rootThreadId: "holder" },
      pendingRuntimeRequest: pending
        ? { kind: childStatus === "side-chat" ? "user_input" : "command" }
        : null,
    } as unknown as Partial<OrchestrationV2ThreadShell>);
    return withMaps({ shells: new Map([["holder", holder]]), listed: [holder, child] }, (root) =>
      Effect.gen(function* () {
        yield* writeTickets(root, { "01-one.md": aged });
        const maps = yield* WayfinderMaps.WayfinderMaps;
        const result = yield* Effect.exit(
          maps.releaseClaim({ cwd: root, mapSlug: "panel", number: 1 }),
        );
        if (pending && childStatus !== "completed") {
          expect(Exit.isFailure(result) ? result.cause.toString() : "").toContain(
            "waiting on the user",
          );
        } else {
          expect(result).toEqual(Exit.succeed({ released: true }));
        }
      }),
    );
  });

  it.effect("releases an Unattended claim without force, then reports nothing to release", () =>
    withMaps({}, (root) =>
      Effect.gen(function* () {
        yield* writeTickets(root, { "01-one.md": claimed });
        const maps = yield* WayfinderMaps.WayfinderMaps;
        const input = { cwd: root, mapSlug: "panel", number: 1 };
        expect(yield* maps.releaseClaim(input)).toEqual({ released: true });
        expect(yield* maps.releaseClaim(input)).toEqual({ released: false });
      }),
    ),
  );
});

describe("WayfinderClaimReactor", () => {
  it.effect("clears a deleted thread's claim on open tickets only", () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
      const sentinelPulled = yield* Deferred.make<void>();
      const holder = TICKET("type: task\nclaimed_by: gone\nclaimed_at: 2026-11-01T00:00:00Z\n");
      const resolved = `${holder}\n## Answer\n\nDone.\n`;
      const other = TICKET("type: task\nclaimed_by: alive\nclaimed_at: 2026-11-01T00:00:00Z\n");
      yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const root = yield* fs.makeTempDirectoryScoped();
          yield* writeTickets(root, {
            "01-one.md": holder,
            "02-two.md": resolved,
            "03-three.md": other,
          });
          const reactor = yield* WayfinderClaimReactor.WayfinderClaimReactor;
          yield* reactor.start();
          yield* Queue.offer(events, {
            type: "thread.deleted",
            threadId: ThreadId.make("gone"),
            payload: { id: ThreadId.make("gone"), projectId: PROJECT_ID, worktreePath: root },
          } as unknown as OrchestrationV2DomainEvent);
          // The stream pulls the sentinel only after the deletion has been enqueued.
          yield* Queue.offer(events, { type: "thread.visited" } as OrchestrationV2DomainEvent);
          yield* Deferred.await(sentinelPulled);
          yield* reactor.drain;
          expect(yield* readTicketFile(root, "01-one.md")).toBe(TICKET("type: task\n"));
          expect(yield* readTicketFile(root, "02-two.md")).toBe(resolved);
          expect(yield* readTicketFile(root, "03-three.md")).toBe(other);
        }),
      ).pipe(
        Effect.provide(
          WayfinderClaimReactor.layer.pipe(
            Layer.provideMerge(WayfinderMaps.layer),
            Layer.provideMerge(
              layerServiceStubs({
                events: Stream.fromQueue(events).pipe(
                  Stream.tap((event) =>
                    event.type === "thread.visited"
                      ? Deferred.succeed(sentinelPulled, undefined)
                      : Effect.void,
                  ),
                ),
              }),
            ),
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      );
    }),
  );
});
