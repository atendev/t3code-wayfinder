import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import type { RootSnapshot } from "./parse.ts";
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

const layerWorkspaceStubs = Layer.mergeAll(
  Layer.mock(KnownWorkspaces.KnownWorkspaces)({ assertContains: () => Effect.void }),
  Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({ detect: () => Effect.succeed(null) }),
);

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
