// @effect-diagnostics nodeBuiltinImport:off - fingerprints hash file bytes with node:crypto.
import * as NodeCrypto from "node:crypto";

import {
  type CommandId,
  ComposerContextId,
  isProviderNativeSubagentThread,
  type ModelSelection,
  type OrchestrationMessageContext,
  type OrchestrationV2LinkOrigin,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  ThreadId,
  WayfinderClaimLiveError,
  type WayfinderDocument,
  type WayfinderMapSummary,
  type WayfinderMapsSnapshot,
  type WayfinderProblem,
  type WayfinderReadMapInput,
  type WayfinderReadTicketInput,
  type WayfinderReleaseClaimInput,
  type WayfinderReleaseClaimResult,
  type WayfinderStartTicketThreadResult,
  WayfinderMapsReadError,
  WayfinderTicketNotFoundError,
  WayfinderTicketNotStartableError,
  type WayfinderTicketSummary,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveProjectDefaultProviderModelSelection } from "@t3tools/shared/providerModelDefault";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { type ClaimantThread, claimSessionState } from "@t3tools/shared/wayfinderClaim";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { resolveRuntimeMode } from "../mcp/delegatedTaskModes.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import { formatClaimedAt, stampClaim, stripClaim } from "./claim.ts";
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
    /** Claims a frontier ticket and launches a thread on it; a retried `commandId` replays. */
    readonly startTicketThread: (
      input: WayfinderStartTicketThreadServiceInput,
    ) => Effect.Effect<
      WayfinderStartTicketThreadResult,
      | WayfinderTicketNotStartableError
      | WayfinderMapsReadError
      | ThreadLaunch.ThreadLaunchError
      | ThreadManagement.ThreadManagementProviderInstanceDisabledError
    >;
    /** Refuses a claim whose thread is working or waiting on the user unless `force` is set. */
    readonly releaseClaim: (
      input: WayfinderReleaseClaimInput,
    ) => Effect.Effect<
      WayfinderReleaseClaimResult,
      WayfinderClaimLiveError | WayfinderTicketNotFoundError | WayfinderMapsReadError
    >;
    /** Strips the claims a deleted thread held on still-open tickets under `cwd`'s root. */
    readonly clearClaimsOf: (input: {
      readonly cwd: string;
      readonly threadId: ThreadId;
    }) => Effect.Effect<void, WayfinderMapsReadError>;
  }
>()("t3/wayfinder/WayfinderMaps") {}

export interface WayfinderStartTicketThreadServiceInput {
  readonly cwd: string;
  readonly projectId: ProjectId;
  readonly mapSlug: string;
  readonly number: number;
  readonly commandId: CommandId;
  /** The agent thread starting it over MCP, with modes already limited to its own. */
  readonly caller?: WayfinderStartTicketThreadCaller;
}

export interface WayfinderStartTicketThreadCaller {
  readonly threadId: ThreadId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly linkOrigin?: OrchestrationV2LinkOrigin | undefined;
}

const padTicketNumber = (number: number) => String(number).padStart(2, "0");

const FRONTMATTER_PROBLEMS: ReadonlySet<WayfinderProblem["reason"]> = new Set([
  "missing-frontmatter",
  "invalid-frontmatter",
  "invalid-type",
]);

/** Why a ticket cannot be started now, or `null` when it is on the frontier and unclaimed. */
const notStartableReason = (
  map: WayfinderMapSummary,
  number: number,
): Pick<WayfinderTicketNotStartableError, "reason" | "blockers" | "claimedBy"> | null => {
  const ticket = map.tickets.find((entry) => entry.number === number);
  if (ticket === undefined) return { reason: "missing" };
  if (ticket.status === "resolved") return { reason: "resolved" };
  if (ticket.status === "out_of_scope") return { reason: "out-of-scope" };
  if (ticket.status === "claimed") return { reason: "claimed", claimedBy: ticket.claimedBy! };
  if (ticket.problems.some((problem) => FRONTMATTER_PROBLEMS.has(problem.reason))) {
    return { reason: "problem" };
  }
  if (ticket.frontier) return null;
  const resolved = new Set(
    map.tickets.filter((entry) => entry.status === "resolved").map((entry) => entry.number),
  );
  return {
    reason: "blocked",
    blockers: ticket.blockedBy.filter((blocker) => !resolved.has(blocker)),
  };
};

const requestNeedsApproval = (shell: OrchestrationV2ThreadShell) => {
  const kind = shell.pendingRuntimeRequest?.kind;
  return kind !== undefined && kind !== "user_input" && kind !== "auth_refresh";
};

// Mirrors client-runtime's `subagentRequest`: an async question outlives the child's run, but the
// parent stops waiting once that run ends.
const isChildRunLive = (thread: OrchestrationV2ThreadShell) =>
  thread.activityRunStatus !== undefined
    ? thread.activityRunStatus !== null
    : thread.status === "preparing" ||
      thread.status === "starting" ||
      thread.status === "running" ||
      thread.status === "waiting";

const childAwaitsApproval = (thread: OrchestrationV2ThreadShell) =>
  requestNeedsApproval(thread) &&
  (thread.lineage.relationshipToParent === "subagent" || thread.delegatedFrom !== undefined) &&
  !isProviderNativeSubagentThread(thread) &&
  isChildRunLive(thread);

/**
 * Whether a subagent below `threadId`, or a side chat on it, waits on the user, as the client's
 * shell index rolls those requests up to the parent. Delegated tasks in linked environments are
 * not known here.
 */
const childAwaitsUser = (threadId: string, threads: ReadonlyArray<OrchestrationV2ThreadShell>) => {
  const byId = new Map(threads.map((thread) => [thread.id, thread] as const));
  return threads.some((child) => {
    if (child.lineage.sideChat === true) {
      const kind = child.pendingRuntimeRequest?.kind;
      return (
        child.lineage.parentThreadId === threadId && kind !== undefined && kind !== "auth_refresh"
      );
    }
    if (!childAwaitsApproval(child)) return false;
    const seen = new Set<string>([child.id]);
    let parentId = child.lineage.parentThreadId;
    while (parentId !== null && !seen.has(parentId)) {
      if (parentId === threadId) return true;
      seen.add(parentId);
      const parent = byId.get(parentId);
      parentId =
        parent?.lineage.relationshipToParent === "subagent" || parent?.lineage.sideChat === true
          ? parent.lineage.parentThreadId
          : null;
    }
    return false;
  });
};

/** The claimant as `claimSessionState` reads it; `null` for a missing or deleted thread. */
const claimantFromShell = (
  shell: OrchestrationV2ThreadShell | null,
  childWaiting: boolean,
): ClaimantThread | null => {
  if (shell === null || shell.deletedAt != null) return null;
  const parkAtIdle =
    backgroundWorkHoldsCompletion(shell.pendingBackgroundTasks ?? []) && shell.status !== "failed";
  const hasRuntime =
    shell.latestRunId !== null || shell.activeProviderThreadId !== null || parkAtIdle;
  const request = shell.pendingRuntimeRequest;
  return {
    archived: shell.archivedAt !== null,
    runtimeStatus: !hasRuntime
      ? null
      : parkAtIdle
        ? "idle"
        : (shell.activityRunStatus ?? shell.status),
    pendingRequest:
      request === null || request.kind === "auth_refresh"
        ? childWaiting
          ? "subagent"
          : null
        : request.kind === "user_input"
          ? "input"
          : "approval",
  };
};

const startPrompt = (mapSlug: string, number: number, fileName: string) =>
  `$wayfinder Work ticket ${padTicketNumber(number)} of the ${mapSlug} map: ` +
  `.plan/maps/${mapSlug}/tickets/${fileName}. Load .plan/maps/${mapSlug}/map.md and that ticket only.`;

const WAYFINDER_SKILL_CONTEXT = {
  version: 1,
  records: [
    {
      version: 1,
      contextId: ComposerContextId.make("wayfinder-skill"),
      label: "wayfinder",
      kind: "skill",
      name: "wayfinder",
    },
  ],
} as OrchestrationMessageContext;

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
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectService.ProjectService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;

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

  // Claim writes for one root run one at a time, so two starts cannot both see it unclaimed.
  const rootLocks = yield* KeyedLock.make<string>();
  const withRootLock = rootLocks.withLock;

  const writeFailed = (cwd: string) => (cause: unknown) =>
    new WayfinderMapsReadError({ cwd, cause });

  /** Re-reads one map from disk; the ticket is `undefined` when its file is gone. */
  const readMapForWrite = Effect.fn("WayfinderMaps.readMapForWrite")(function* (
    cwd: string,
    root: string,
    mapSlug: string,
    number: number,
  ) {
    yield* assertWorkspace(cwd);
    const mapDir = yield* mapDirectory(cwd, mapSlug);
    const ticketsDir = path.join(mapDir, "tickets");
    const ticketFiles = yield* provideFs(readTicketFiles(ticketsDir));
    const mapFile = yield* provideFs(readFileOrNull(path.join(mapDir, "map.md")));
    const map = parseMap({
      slug: mapSlug,
      mapFile: { name: "map.md", text: mapFile?.text ?? "", fingerprint: "" },
      ticketFiles,
    });
    const fileName = ticketFileOwners(ticketFiles.map((file) => file.name)).owners.get(number);
    const file = ticketFiles.find((entry) => entry.name === fileName);
    const ticket: WayfinderTicketSummary | undefined = map.tickets.find(
      (entry) => entry.number === number,
    );
    return {
      map,
      ticket,
      file:
        file === undefined || file.text === null
          ? undefined
          : { name: file.name, text: file.text, path: path.join(ticketsDir, file.name) },
      ticketPath: mapsRelativePath(mapSlug, "tickets", fileName ?? ""),
      root,
    };
  });

  const writeTicket = (cwd: string, filePath: string, contents: string) =>
    provideFs(writeFileStringAtomically({ filePath, contents })).pipe(
      Effect.mapError(writeFailed(cwd)),
    );

  const launchSettings = Effect.fn("WayfinderMaps.launchSettings")(function* (input: {
    readonly cwd: string;
    readonly projectId: ProjectId;
    readonly commandId: CommandId;
    readonly caller?: WayfinderStartTicketThreadCaller | undefined;
  }) {
    const launchError = (cause: unknown) =>
      new ThreadLaunch.ThreadLaunchError({
        operation: "resolve-project",
        commandId: input.commandId,
        projectId: input.projectId,
        cause,
      });
    const project = Option.getOrUndefined(
      yield* projects.getById(input.projectId).pipe(Effect.mapError(launchError)),
    );
    if (project === undefined) return yield* launchError(new Error("The project was not found."));
    const workspaceStrategy: ThreadLaunch.ThreadLaunchWorkspaceStrategy =
      path.resolve(input.cwd) === path.resolve(project.workspaceRoot)
        ? { type: "root" }
        : { type: "existing_worktree", worktreePath: input.cwd };
    if (input.caller !== undefined) {
      const { modelSelection, runtimeMode, interactionMode } = input.caller;
      return { modelSelection, runtimeMode, interactionMode, workspaceStrategy };
    }
    const settings = resolveProjectSettings(
      yield* serverSettings.getSettings.pipe(Effect.mapError(launchError)),
      input.projectId,
      project,
    ).settings;
    const providers = yield* providerRegistry.getProviders;
    const modelSelection = resolveNewThreadModelSelection({
      defaultSelection:
        settings.defaultModelSelection ??
        resolveProjectDefaultProviderModelSelection(providers, settings, input.projectId),
      fallbackSelection: settings.fallbackModelSelection,
      providers,
      settings,
      projectId: input.projectId,
      now: yield* Clock.currentTimeMillis,
    }).selection;
    if (modelSelection === null) {
      return yield* launchError(
        new Error("No provider is ready. Set one up in Settings, then try again."),
      );
    }
    const runtimeMode = yield* resolveRuntimeMode(settings.defaultRuntimeMode, undefined, {
      modelSelection,
      supportedRuntimeModes: providers.find(
        (provider) => provider.instanceId === modelSelection.instanceId,
      )?.supportedRuntimeModes,
    }).pipe(Effect.orElseSucceed(() => settings.defaultRuntimeMode));
    const interactionMode: ProviderInteractionMode = "default";
    return { modelSelection, runtimeMode, interactionMode, workspaceStrategy };
  });

  const threadExists = (threadId: ThreadId) =>
    orchestrator.getThreadShell(threadId).pipe(
      Effect.map((shell) => shell !== null && shell.deletedAt === null),
      // An unreadable projection keeps the claim: a thread that exists must not lose it.
      Effect.orElseSucceed(() => true),
    );

  const startTicketThread: WayfinderMaps["Service"]["startTicketThread"] = Effect.fn(
    "WayfinderMaps.startTicketThread",
  )(function* (input) {
    const root = yield* resolveRoot(input.cwd);
    const threadId = ThreadId.make(input.commandId);
    const caller = input.caller;
    const notStartable = (
      detail: Pick<WayfinderTicketNotStartableError, "reason" | "blockers" | "claimedBy">,
    ) =>
      new WayfinderTicketNotStartableError({
        mapSlug: input.mapSlug,
        number: input.number,
        ...detail,
      });
    return yield* withRootLock(
      root,
      Effect.gen(function* () {
        const located = yield* readMapForWrite(input.cwd, root, input.mapSlug, input.number).pipe(
          Effect.catchTags({
            WayfinderTicketNotFoundError: () => Effect.fail(notStartable({ reason: "missing" })),
          }),
        );
        const file = located.file;
        if (file === undefined) return yield* notStartable({ reason: "missing" });
        // A retry whose first attempt claimed the ticket replays the launch.
        const replaying = located.ticket?.claimedBy === threadId;
        if (!replaying) {
          const refusal = notStartableReason(located.map, input.number);
          if (refusal !== null) return yield* notStartable(refusal);
        }
        const settings = yield* launchSettings(input);
        if (!replaying) {
          const claimedAt = formatClaimedAt(yield* Clock.currentTimeMillis);
          yield* writeTicket(input.cwd, file.path, stampClaim(file.text, threadId, claimedAt));
        }
        yield* launches
          .launch({
            commandId: input.commandId,
            threadId,
            projectId: input.projectId,
            title: `${padTicketNumber(input.number)} ${located.ticket?.title ?? file.name}`,
            generateTitle: false,
            modelSelection: settings.modelSelection,
            runtimeMode: settings.runtimeMode,
            interactionMode: settings.interactionMode,
            workspaceStrategy: settings.workspaceStrategy,
            initialMessage: {
              text: startPrompt(input.mapSlug, input.number, file.name),
              attachments: [],
              context: WAYFINDER_SKILL_CONTEXT,
              ...(caller === undefined ? {} : { senderThreadId: caller.threadId }),
            },
            ...(caller === undefined
              ? { createdBy: "user", creationSource: "web" }
              : {
                  // An agent launch makes ThreadLaunchService recheck the modes under DispatchModeLimit.
                  createdBy: "agent",
                  creationSource: "mcp",
                  ...(caller.linkOrigin === undefined ? {} : { linkOrigin: caller.linkOrigin }),
                }),
          })
          .pipe(
            // A failed or interrupted launch that left no thread gives the ticket back.
            Effect.onExit((exit) =>
              Exit.isSuccess(exit)
                ? Effect.void
                : Effect.gen(function* () {
                    if (yield* threadExists(threadId)) return;
                    const current = yield* provideFs(readFileOrNull(file.path));
                    if (current === null) return;
                    yield* writeTicket(input.cwd, file.path, stripClaim(current.text));
                  }).pipe(Effect.ignore({ log: true })),
            ),
          );
        return { threadId, ticketPath: located.ticketPath };
      }),
    );
  });

  const releaseClaim: WayfinderMaps["Service"]["releaseClaim"] = Effect.fn(
    "WayfinderMaps.releaseClaim",
  )(function* (input) {
    const root = yield* resolveRoot(input.cwd);
    return yield* withRootLock(
      root,
      Effect.gen(function* () {
        const located = yield* readMapForWrite(input.cwd, root, input.mapSlug, input.number);
        if (located.file === undefined) {
          return yield* new WayfinderTicketNotFoundError({
            mapSlug: input.mapSlug,
            number: input.number,
          });
        }
        const claimedBy = located.ticket?.claimedBy ?? null;
        if (claimedBy === null) return { released: false };
        if (input.force !== true) {
          const shell = yield* orchestrator
            .getThreadShell(ThreadId.make(claimedBy))
            .pipe(Effect.mapError(writeFailed(input.cwd)));
          // The shell snapshot keeps side chats, which the thread listings leave out.
          const childWaiting =
            shell === null
              ? false
              : childAwaitsUser(
                  claimedBy,
                  (yield* orchestrator
                    .getShellSnapshot({ location: "active", projectId: shell.projectId })
                    .pipe(Effect.mapError(writeFailed(input.cwd)))).threads,
                );
          const session = claimSessionState(
            claimantFromShell(shell, childWaiting),
            located.ticket?.claimedAt ?? null,
            yield* Clock.currentTimeMillis,
          );
          if (session.state === "working" || session.state === "needs-you") {
            return yield* new WayfinderClaimLiveError({
              number: input.number,
              state: session.state,
              threadId: claimedBy,
            });
          }
        }
        yield* writeTicket(input.cwd, located.file.path, stripClaim(located.file.text));
        return { released: true };
      }),
    );
  });

  const clearClaimsOf: WayfinderMaps["Service"]["clearClaimsOf"] = Effect.fn(
    "WayfinderMaps.clearClaimsOf",
  )(function* (input) {
    yield* assertWorkspace(input.cwd);
    const root = yield* resolveRoot(input.cwd);
    yield* withRootLock(
      root,
      Effect.gen(function* () {
        const snapshot = yield* provideFs(readRootSnapshot(root));
        for (const map of snapshot.maps) {
          for (const ticket of map.tickets) {
            // A resolved or ruled-out ticket keeps its inert claim.
            if (ticket.status !== "claimed" || ticket.claimedBy !== input.threadId) continue;
            const located = yield* readMapForWrite(input.cwd, root, map.slug, ticket.number).pipe(
              Effect.catchTags({ WayfinderTicketNotFoundError: () => Effect.succeed(null) }),
            );
            if (located?.file === undefined || located.ticket?.status !== "claimed") continue;
            if (located.ticket.claimedBy !== input.threadId) continue;
            yield* writeTicket(input.cwd, located.file.path, stripClaim(located.file.text));
          }
        }
      }),
    );
  });

  return WayfinderMaps.of({
    getSnapshot,
    streamSnapshots,
    readTicket,
    readMap,
    startTicketThread,
    releaseClaim,
    clearClaimsOf,
  });
});

export const layer = Layer.effect(WayfinderMaps, make).pipe(
  Layer.provide(WayfinderRootWatcherMap.layer),
);
