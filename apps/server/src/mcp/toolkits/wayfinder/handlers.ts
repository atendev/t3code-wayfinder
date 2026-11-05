import {
  OrchestratorMcpFailure,
  type OrchestrationV2ThreadShell,
  type WayfinderClaimLiveError,
  type WayfinderMapsReadError,
  type WayfinderTicketNotFoundError,
  type WayfinderTicketNotStartableError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { OrchestratorRuntimeModeAboveCeilingError } from "../../../orchestration-v2/Orchestrator.ts";
import type * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import type * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as WayfinderMaps from "../../../wayfinder/WayfinderMaps.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { launchCommandId, newCommandId, readCaller, unavailable } from "../../threadAccess.ts";
import { WayfinderToolkit } from "./tools.ts";

const isAboveCeilingError = Schema.is(OrchestratorRuntimeModeAboveCeilingError);

const pad = (number: number) => String(number).padStart(2, "0");

const refused = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const notStartableMessage = (error: WayfinderTicketNotStartableError) => {
  const ticket = `Ticket ${pad(error.number)}`;
  switch (error.reason) {
    case "missing":
      return `${ticket} of the ${error.mapSlug} map does not exist.`;
    case "resolved":
      return `${ticket} is already resolved.`;
    case "out-of-scope":
      return `${ticket} is out of scope.`;
    case "claimed":
      return `${ticket} is already claimed by thread ${error.claimedBy ?? "unknown"}.`;
    case "blocked":
      return `${ticket} is blocked by ${(error.blockers ?? []).map(pad).join(", ")}. Resolve those first.`;
    case "problem":
      return `${ticket} has a frontmatter problem. Fix the file first.`;
  }
};

const wayfinderFailure = (
  error:
    | WayfinderTicketNotStartableError
    | WayfinderClaimLiveError
    | WayfinderTicketNotFoundError
    | WayfinderMapsReadError
    | ThreadLaunch.ThreadLaunchError
    | ThreadManagement.ThreadManagementProviderInstanceDisabledError,
) => {
  switch (error._tag) {
    case "WayfinderTicketNotStartableError":
      return refused(notStartableMessage(error));
    case "WayfinderClaimLiveError":
      return refused(
        `Ticket ${pad(error.number)}'s claim is held by thread ${error.threadId}, which is ${
          error.state === "working" ? "working" : "waiting on the user"
        }. Pass force: true only if the user asked.`,
      );
    case "WayfinderTicketNotFoundError":
      return refused(
        error.number === undefined
          ? error.message
          : `Ticket ${pad(error.number)} of the ${error.mapSlug} map does not exist.`,
      );
    case "WayfinderMapsReadError":
      return new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
    case "ThreadManagementProviderInstanceDisabledError":
      return refused(error.message);
    case "ThreadLaunchError":
      return isAboveCeilingError(error.cause) ? refused(error.cause.message) : unavailable();
  }
};

/** Ticket files live in the calling thread's checkout, so a caller outside a thread has none. */
const callerCheckout = Effect.fn("mcp.wayfinder.callerCheckout")(function* () {
  const { caller } = yield* readCaller();
  if (caller === undefined)
    return yield* new OrchestratorMcpFailure({
      code: "thread_credential_required",
      message:
        "Wayfinder tools act in the calling T3 thread's checkout, so they need an agent running inside T3 Code. This MCP client signed in from outside a thread.",
    });
  const cwd = yield* checkoutOf(caller);
  return { caller, cwd };
});

const checkoutOf = Effect.fn("mcp.wayfinder.checkoutOf")(function* (
  caller: OrchestrationV2ThreadShell,
) {
  if (caller.worktreePath !== null) return caller.worktreePath;
  const project = yield* Project.ProjectService.pipe(
    Effect.flatMap((projects) => projects.getById(caller.projectId)),
    Effect.mapError(unavailable),
  );
  if (Option.isNone(project))
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "The calling thread's project was not found.",
    });
  return project.value.workspaceRoot;
});

export const layer = McpToolAccess.toLayer(WayfinderToolkit, {
  t3_wayfinder_start: McpToolAccess.startsThreads(
    () => ({}),
    (input, { runtimeMode, interactionMode, linkOrigin }) =>
      Effect.gen(function* () {
        const { caller, cwd } = yield* callerCheckout();
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const commandId =
          input.clientRequestId === undefined
            ? yield* newCommandId()
            : yield* launchCommandId(scope.requestNamespace, `wayfinder:${input.clientRequestId}`);
        const wayfinder = yield* WayfinderMaps.WayfinderMaps;
        const result = yield* wayfinder
          .startTicketThread({
            cwd,
            projectId: caller.projectId,
            mapSlug: input.mapSlug,
            number: input.number,
            commandId,
            caller: {
              threadId: caller.id,
              modelSelection: caller.modelSelection,
              runtimeMode,
              interactionMode,
              linkOrigin,
            },
          })
          .pipe(Effect.mapError(wayfinderFailure));
        return { ...result, link: McpInvocationContext.threadLinkFor(scope, result.threadId) };
      }),
    { refused: "start a Wayfinder ticket thread for a linked environment" },
  ),
  t3_wayfinder_release: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { cwd } = yield* callerCheckout();
      const wayfinder = yield* WayfinderMaps.WayfinderMaps;
      return yield* wayfinder
        .releaseClaim({
          cwd,
          mapSlug: input.mapSlug,
          number: input.number,
          ...(input.force === undefined ? {} : { force: input.force }),
        })
        .pipe(Effect.mapError(wayfinderFailure));
    }),
  ),
});
