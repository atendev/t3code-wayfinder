// @effect-diagnostics nodeBuiltinImport:off - fingerprints hash file bytes with node:crypto.
import * as NodeCrypto from "node:crypto";

import {
  type WayfinderDocument,
  type WayfinderMapSummary,
  type WayfinderMapsSnapshot,
  type WayfinderProblem,
  type WayfinderReadMapInput,
  type WayfinderReadTicketInput,
  WayfinderMapsReadError,
  WayfinderTicketNotFoundError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import {
  holdMidWrite,
  mapsRelativePath,
  parseDocument,
  parseMap,
  type RootSnapshot,
  ticketFileOwners,
  ticketFileSlug,
  type WayfinderFile,
} from "./parse.ts";

const MAX_FILE_BYTES = 1024 * 1024;
const REFRESH_DEBOUNCE = Duration.millis(250);
const MID_WRITE_REREAD_DELAY = Duration.millis(500);
const WATCHER_IDLE_TTL = Duration.seconds(30);

export class WayfinderMaps extends Context.Service<
  WayfinderMaps,
  {
    readonly getSnapshot: (
      cwd: string,
    ) => Effect.Effect<WayfinderMapsSnapshot, WayfinderMapsReadError>;
    /** The current snapshot first, then one per change. */
    readonly streamSnapshots: (
      cwd: string,
    ) => Stream.Stream<WayfinderMapsSnapshot, WayfinderMapsReadError>;
    readonly readTicket: (
      input: WayfinderReadTicketInput,
    ) => Effect.Effect<WayfinderDocument, WayfinderMapsReadError | WayfinderTicketNotFoundError>;
    readonly readMap: (
      input: WayfinderReadMapInput,
    ) => Effect.Effect<WayfinderDocument, WayfinderMapsReadError | WayfinderTicketNotFoundError>;
  }
>()("t3/wayfinder/WayfinderMaps") {}

const fingerprint = (bytes: Uint8Array) =>
  NodeCrypto.createHash("sha256").update(bytes).digest("base64url").slice(0, 22);

const readCapped = Effect.fn("WayfinderMaps.readCapped")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(filePath);
  if (info.type !== "File" || Number(info.size) > MAX_FILE_BYTES) return null;
  const bytes = yield* fs.readFile(filePath);
  if (bytes.byteLength > MAX_FILE_BYTES) return null;
  return { text: new TextDecoder().decode(bytes), fingerprint: fingerprint(bytes) };
});

const readFileOrNull = (filePath: string) =>
  readCapped(filePath).pipe(Effect.orElseSucceed(() => null));

const listDirectory = Effect.fn("WayfinderMaps.listDirectory")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readDirectory(directory);
});

const readTicketFiles = Effect.fn("WayfinderMaps.readTicketFiles")(function* (ticketsDir: string) {
  const path = yield* Path.Path;
  const names = yield* listDirectory(ticketsDir).pipe(
    Effect.orElseSucceed((): ReadonlyArray<string> => []),
  );
  return yield* Effect.forEach(
    names.filter((name) => name.endsWith(".md")),
    Effect.fnUntraced(function* (name): Effect.fn.Return<
      WayfinderFile,
      never,
      FileSystem.FileSystem
    > {
      const file = yield* readFileOrNull(path.join(ticketsDir, name));
      return file === null ? { name, text: null, fingerprint: "" } : { name, ...file };
    }),
    { concurrency: 16 },
  );
});

/** Never fails: unreadable folders and files become snapshot and map problems. */
const readRootSnapshot = Effect.fn("WayfinderMaps.readRootSnapshot")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const mapsDir = path.join(root, ".plan", "maps");
  const entries = yield* listDirectory(mapsDir).pipe(
    Effect.map((names) => ({ names, unreadable: false })),
    Effect.catchTags({
      PlatformError: (cause) =>
        Effect.succeed({
          names: [] as ReadonlyArray<string>,
          unreadable: cause.reason._tag !== "NotFound",
        }),
    }),
  );
  const problems: Array<WayfinderProblem> = entries.unreadable
    ? [{ path: mapsRelativePath(), reason: "unreadable" }]
    : [];
  const maps: Array<WayfinderMapSummary> = [];
  for (const slug of entries.names.toSorted()) {
    const mapDir = path.join(mapsDir, slug);
    const isDirectory = yield* fs.stat(mapDir).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
    if (!isDirectory) continue;
    const mapFile = yield* readFileOrNull(path.join(mapDir, "map.md"));
    if (mapFile === null) {
      problems.push({ path: mapsRelativePath(slug, "map.md"), reason: "unreadable" });
      continue;
    }
    const ticketFiles = yield* readTicketFiles(path.join(mapDir, "tickets"));
    maps.push(parseMap({ slug, mapFile: { name: "map.md", ...mapFile }, ticketFiles }));
  }
  return { root, maps, problems } satisfies RootSnapshot;
});

/**
 * Follows `<root>/.plan/maps` recursively, or its nearest existing parent non-recursively until
 * the folder appears. Never creates the folder.
 */
const watchMapsFolder = (root: string, onReady: () => void) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const mapsDir = path.join(root, ".plan", "maps");
      const planDir = path.join(root, ".plan");
      const target = Effect.gen(function* () {
        if (yield* fs.exists(mapsDir).pipe(Effect.orElseSucceed(() => false))) return mapsDir;
        if (yield* fs.exists(planDir).pipe(Effect.orElseSucceed(() => false))) return planDir;
        return root;
      });
      // A watch that ends (its folder removed) or sees the target move re-resolves and follows on.
      const refollow = (from: string): Stream.Stream<void> =>
        Stream.unwrap(
          Effect.map(target, (next) =>
            next === from ? Stream.empty : Stream.concat(Stream.make(undefined), follow(next)),
          ),
        );
      const follow = (current: string): Stream.Stream<void> =>
        current === mapsDir
          ? fs
              .watch(mapsDir, { recursive: true, onReady })
              .pipe(
                Stream.as(undefined),
                Stream.ignore({ log: true }),
                Stream.concat(refollow(mapsDir)),
              )
          : fs.watch(current, { onReady }).pipe(
              Stream.ignore({ log: true }),
              Stream.mapEffect(() => target),
              Stream.filter((next) => next !== current),
              Stream.take(1),
              Stream.drain,
              Stream.concat(refollow(current)),
            );
      return follow(yield* target);
    }),
  );

interface Published {
  readonly seq: number;
  readonly snapshot: RootSnapshot | null;
}

/**
 * Publishes the root's snapshot on each debounced change, skipping unchanged ones. `changes`
 * calls `onReady` once its watch is armed; the first read waits for it so no write slips between
 * them. Requires a scope that owns the watch.
 */
export const makeRootWatcher = Effect.fn("WayfinderMaps.makeRootWatcher")(function* <R>(options: {
  readonly changes: (onReady: () => void) => Stream.Stream<unknown>;
  readonly read: Effect.Effect<RootSnapshot, never, R>;
}) {
  // Sequence numbers let subscribers drop queued pushes older than their initial snapshot.
  const changes = yield* PubSub.sliding<Published>(1);
  const published = yield* Ref.make<Published>({ seq: 0, snapshot: null });
  // Serialize read/compare/publish so a slow older read cannot publish over a newer one.
  const refreshSemaphore = yield* Semaphore.make(1);
  const scope = yield* Effect.scope;

  const refresh = (guard: boolean): Effect.Effect<void, never, R> =>
    refreshSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const read = yield* options.read;
        const previous = (yield* Ref.get(published)).snapshot;
        const { snapshot, held } =
          guard && previous !== null
            ? holdMidWrite(previous, read)
            : { snapshot: read, held: false };
        const next = yield* Ref.modify(
          published,
          (current): readonly [Published | null, Published] => {
            if (Equal.equals(current.snapshot, snapshot)) return [null, current];
            const updated = { seq: current.seq + 1, snapshot };
            return [updated, updated];
          },
        );
        if (next !== null) yield* PubSub.publish(changes, next);
        if (held) {
          yield* refresh(false).pipe(Effect.delay(MID_WRITE_REREAD_DELAY), Effect.forkIn(scope));
        }
      }),
    );

  const ready = yield* Deferred.make<void>();
  yield* Stream.suspend(() => options.changes(() => Deferred.doneUnsafe(ready, Exit.void))).pipe(
    Stream.debounce(REFRESH_DEBOUNCE),
    Stream.runForEach(() => refresh(true)),
    // A watch that ends or fails before arming must not hang the first read.
    Effect.ensuring(Deferred.succeed(ready, undefined)),
    Effect.forkIn(scope),
  );
  yield* Deferred.await(ready);
  yield* refresh(false);

  return {
    changes: Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        const current = yield* Ref.get(published);
        return Stream.concat(
          // The first read published before construction returned.
          Stream.make(current.snapshot!),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((update) => update.seq > current.seq),
            Stream.map((update) => update.snapshot!),
          ),
        );
      }),
    ),
  };
});

class WayfinderRootWatcher extends Context.Service<
  WayfinderRootWatcher,
  { readonly changes: Stream.Stream<RootSnapshot> }
>()("t3/wayfinder/WayfinderMaps/WayfinderRootWatcher") {}

const rootWatcherLayer = (root: string) =>
  Layer.effect(
    WayfinderRootWatcher,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return yield* makeRootWatcher({
        changes: (onReady) =>
          watchMapsFolder(root, onReady).pipe(
            Stream.provideService(FileSystem.FileSystem, fs),
            Stream.provideService(Path.Path, path),
          ),
        read: readRootSnapshot(root).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        ),
      });
    }),
  );

/** One watcher per resolved root, kept for an idle TTL after its last subscriber leaves. */
class WayfinderRootWatcherMap extends LayerMap.Service<WayfinderRootWatcherMap>()(
  "t3/wayfinder/WayfinderRootWatcherMap",
  { lookup: rootWatcherLayer, idleTimeToLive: WATCHER_IDLE_TTL },
) {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const watchers = yield* WayfinderRootWatcherMap;

  const provideFs = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const assertWorkspace = (cwd: string) =>
    knownWorkspaces
      .assertContains(cwd)
      .pipe(Effect.mapError((cause) => new WayfinderMapsReadError({ cwd, cause })));

  // A monorepo subfolder project still finds the repository's maps; a worktree is its own root.
  const resolveRoot = Effect.fn("WayfinderMaps.resolveRoot")(function* (cwd: string) {
    const handle = yield* vcsRegistry
      .detect({ cwd, requestedKind: "auto" })
      .pipe(Effect.orElseSucceed(() => null));
    return handle?.repository.rootPath ?? path.resolve(cwd);
  });

  const withCwd = (cwd: string, snapshot: RootSnapshot): WayfinderMapsSnapshot => ({
    cwd,
    root: snapshot.root,
    maps: snapshot.maps,
    problems: snapshot.problems,
  });

  const getSnapshot: WayfinderMaps["Service"]["getSnapshot"] = Effect.fn(
    "WayfinderMaps.getSnapshot",
  )(function* (cwd) {
    yield* assertWorkspace(cwd);
    const root = yield* resolveRoot(cwd);
    return withCwd(cwd, yield* provideFs(readRootSnapshot(root)));
  });

  // The workspace check runs once per subscription, not per push.
  const openSnapshots = Effect.fn("WayfinderMaps.streamSnapshots")(function* (cwd: string) {
    yield* assertWorkspace(cwd);
    const root = yield* resolveRoot(cwd);
    const context = yield* watchers.contextEffect(root);
    const watcher = Context.get(context, WayfinderRootWatcher);
    return watcher.changes.pipe(Stream.map((snapshot) => withCwd(cwd, snapshot)));
  });
  const streamSnapshots: WayfinderMaps["Service"]["streamSnapshots"] = (cwd) =>
    Stream.unwrap(openSnapshots(cwd));

  const mapDirectory = Effect.fn("WayfinderMaps.mapDirectory")(function* (
    cwd: string,
    mapSlug: string,
  ) {
    yield* assertWorkspace(cwd);
    const root = yield* resolveRoot(cwd);
    const mapsDir = path.join(root, ".plan", "maps");
    // Only listed folder names resolve, so a slug can never leave the maps folder.
    const slugs = yield* fs.readDirectory(mapsDir).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed([] as ReadonlyArray<string>)
            : Effect.fail(new WayfinderMapsReadError({ cwd, cause })),
      }),
    );
    if (!slugs.includes(mapSlug)) return yield* new WayfinderTicketNotFoundError({ mapSlug });
    return path.join(mapsDir, mapSlug);
  });

  const readDocument = Effect.fn("WayfinderMaps.readDocument")(function* (
    cwd: string,
    filePath: string,
    fallbackTitle: string,
    notFound: WayfinderTicketNotFoundError,
  ) {
    const file = yield* provideFs(readCapped(filePath)).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.fail(notFound)
            : Effect.fail(new WayfinderMapsReadError({ cwd, cause })),
      }),
    );
    if (file === null) {
      return yield* new WayfinderMapsReadError({ cwd, cause: new Error("File is not readable.") });
    }
    const document = parseDocument(file.text);
    return {
      fingerprint: file.fingerprint,
      title: document.title ?? fallbackTitle,
      sections: document.sections,
    } satisfies WayfinderDocument;
  });

  const readTicket: WayfinderMaps["Service"]["readTicket"] = Effect.fn("WayfinderMaps.readTicket")(
    function* (input) {
      const notFound = new WayfinderTicketNotFoundError({
        mapSlug: input.mapSlug,
        number: input.number,
      });
      const mapDir = yield* mapDirectory(input.cwd, input.mapSlug);
      const ticketsDir = path.join(mapDir, "tickets");
      const names = yield* fs
        .readDirectory(ticketsDir)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      const name = ticketFileOwners(names).owners.get(input.number);
      if (name === undefined) return yield* notFound;
      return yield* readDocument(
        input.cwd,
        path.join(ticketsDir, name),
        ticketFileSlug(name),
        notFound,
      );
    },
  );

  const readMap: WayfinderMaps["Service"]["readMap"] = Effect.fn("WayfinderMaps.readMap")(
    function* (input) {
      const mapDir = yield* mapDirectory(input.cwd, input.mapSlug);
      return yield* readDocument(
        input.cwd,
        path.join(mapDir, "map.md"),
        input.mapSlug,
        new WayfinderTicketNotFoundError({ mapSlug: input.mapSlug }),
      );
    },
  );

  return WayfinderMaps.of({ getSnapshot, streamSnapshots, readTicket, readMap });
});

export const layer = Layer.effect(WayfinderMaps, make).pipe(
  Layer.provide(WayfinderRootWatcherMap.layer),
);
