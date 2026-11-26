import {
  CommandId,
  IssueOperationError,
  type IssueTrackerBindProjectInput,
  type IssueTrackerConnectInput,
  IssueTrackerConnectionError,
  IssueTrackerKind,
  IssueUnavailableError,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type * as NativeIssues from "../../issue/IssueService.ts";
import type * as NativeConnections from "../../issue/IssueTrackerConnections.ts";
import { OrchestratorCommandRejectedError } from "../../orchestration-v2/Orchestrator.ts";
import type * as NativeThreadIssues from "../../orchestration-v2/ThreadIssueService.ts";

// Use the native service keys without importing the persistence or tracker implementations.
export const IssueService = Context.Service<
  NativeIssues.IssueService,
  NativeIssues.IssueService["Service"]
>("t3/issue/IssueService");
export const IssueTrackerConnections = Context.Service<
  NativeConnections.IssueTrackerConnections,
  NativeConnections.IssueTrackerConnections["Service"]
>("t3/issue/IssueTrackerConnections");
export const ThreadIssueService = Context.Service<
  NativeThreadIssues.ThreadIssueService,
  NativeThreadIssues.ThreadIssueService["Service"]
>("t3/orchestration-v2/ThreadIssueService");

const unavailable = Effect.fail(new IssueUnavailableError({ reason: "tracker-unsupported" }));
const reject = () => unavailable;

const rejectConnection = (tracker: IssueTrackerKind) =>
  Effect.fail(
    new IssueTrackerConnectionError({
      tracker,
      reason: "unknown-tracker",
      detail: "Issue tracker connections are unavailable in Paperkite.",
    }),
  );

const rejectThreadCommand = (
  commandType: "thread.issue.link" | "thread.issue.unlink",
  threadId: ThreadId,
) =>
  Effect.fail(
    new OrchestratorCommandRejectedError({
      commandId: CommandId.make(`paperkite:${commandType}:${threadId}`),
      commandType,
      cause: new IssueUnavailableError({ reason: "tracker-unsupported" }),
    }),
  );

export const layer = Layer.mergeAll(
  Layer.succeed(IssueService, {
    list: Effect.fn("IssueService.list")(() =>
      Effect.succeed({
        viewers: {},
        trackers: [],
        entries: [],
        errors: [],
        nextCursors: {},
        scopes: [],
      }),
    ),
    detail: reject,
    linkMetadata: reject,
    comments: reject,
    templates: reject,
    candidates: reject,
    create: reject,
    comment: reject,
    update: reject,
    setState: reject,
    react: reject,
    projectScope: reject,
    resolveUrl: reject,
  }),
  Layer.succeed(IssueTrackerConnections, {
    list: Effect.succeed({ trackers: [], accounts: [], bindings: {}, accountBindings: {} }),
    connect: Effect.fn("IssueTrackerConnections.connect")((input: IssueTrackerConnectInput) =>
      rejectConnection(input.tracker),
    ),
    bindProject: Effect.fn("IssueTrackerConnections.bindProject")(
      (input: IssueTrackerBindProjectInput) =>
        rejectConnection(input.binding?.tracker ?? IssueTrackerKind.make("none")),
    ),
  }),
  Layer.succeed(ThreadIssueService, {
    link: Effect.fn("ThreadIssueService.link")((input: NativeThreadIssues.LinkThreadIssueInput) =>
      rejectThreadCommand("thread.issue.link", input.threadId),
    ),
    unlink: Effect.fn("ThreadIssueService.unlink")(
      (input: NativeThreadIssues.UnlinkThreadIssueInput) =>
        rejectThreadCommand("thread.issue.unlink", input.threadId),
    ),
    linkedThreads: Effect.fn("ThreadIssueService.linkedThreads")(() =>
      Effect.fail(
        new IssueOperationError({
          operation: "linkedThreads",
          detail: "Issue links are unavailable in Paperkite.",
        }),
      ),
    ),
  }),
);
