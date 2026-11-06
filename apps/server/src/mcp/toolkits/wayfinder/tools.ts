import {
  NonNegativeInt,
  OrchestratorMcpClientRequestId,
  OrchestratorMcpFailure,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as WayfinderMaps from "../../../wayfinder/WayfinderMaps.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    WayfinderMaps.WayfinderMaps,
    Crypto.Crypto,
  ],
};

const ticket = {
  mapSlug: TrimmedNonEmptyString.annotate({ description: "The folder under `.plan/maps/`." }),
  number: NonNegativeInt,
};

const WayfinderStartTool = Tool.make("t3_wayfinder_start", {
  ...shared,
  description:
    "Start a new thread on one Wayfinder ticket in this thread's checkout and claim the ticket for it. Frontier tickets only: open, unclaimed, every blocker resolved. Not for working a ticket yourself; read its file. After an error or lost reply, retry with the same `clientRequestId`. Mention the thread with its `link`.",
  parameters: Schema.Struct({
    ...ticket,
    clientRequestId: Schema.optional(OrchestratorMcpClientRequestId),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    link: Schema.optional(Schema.String),
    ticketPath: Schema.String,
  }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const WayfinderReleaseTool = Tool.make("t3_wayfinder_release", {
  ...shared,
  description:
    "Clear a Wayfinder ticket's claim. A claim whose thread is working or waiting on the user needs `force: true`.",
  parameters: Schema.Struct({
    ...ticket,
    force: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({ released: Schema.Boolean }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true);

export const WayfinderToolkit = Toolkit.make(WayfinderStartTool, WayfinderReleaseTool);
