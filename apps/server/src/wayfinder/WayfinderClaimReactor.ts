import type { OrchestrationV2AppThread } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as WayfinderMaps from "./WayfinderMaps.ts";

/** Clears the Wayfinder claims a deleted thread held, so its tickets return to the frontier. */
export class WayfinderClaimReactor extends Context.Service<
  WayfinderClaimReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/wayfinder/WayfinderClaimReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const maps = yield* WayfinderMaps.WayfinderMaps;
  const projects = yield* ProjectService.ProjectService;

  const clearClaims = Effect.fn("WayfinderClaimReactor.clearClaims")(
    function* (thread: OrchestrationV2AppThread) {
      const cwd =
        thread.worktreePath ??
        Option.getOrUndefined(yield* projects.getById(thread.projectId, { includeDeleted: true }))
          ?.workspaceRoot;
      if (cwd === undefined) return;
      yield* maps.clearClaimsOf({ cwd, threadId: thread.id });
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Clearing a deleted thread's Wayfinder claims failed", { cause }),
    ),
  );

  const worker = yield* makeDrainableWorker(clearClaims);

  const start: WayfinderClaimReactor["Service"]["start"] = Effect.fn("WayfinderClaimReactor.start")(
    function* () {
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          event.type === "thread.deleted" ? worker.enqueue(event.payload) : Effect.void,
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Wayfinder claim event stream failed", { cause }),
          ),
        ),
      );
    },
  );

  return { start, drain: worker.drain } satisfies WayfinderClaimReactor["Service"];
});

export const layer = Layer.effect(WayfinderClaimReactor, make);
