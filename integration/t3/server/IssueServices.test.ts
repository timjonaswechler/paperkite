import { expect, it } from "@effect/vitest";
import { IssueTrackerKind, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ProjectService from "../../project/ProjectService.ts";
import * as WorkflowForge from "../../workflows/WorkflowForge.ts";
import * as IssueServices from "./IssueServices.ts";
import * as Runtime from "./Runtime.ts";

const projectId = ProjectId.make("fixture");
const tracker = IssueTrackerKind.make("linear");
const ref = { projectId, tracker, host: "linear.app", scope: "ENG", key: "ENG-1" };

it.effect("discovers no issue trackers and rejects reads, account changes, and issue writes", () =>
  Effect.gen(function* () {
    const issues = yield* IssueServices.IssueService;
    const connections = yield* IssueServices.IssueTrackerConnections;
    const threadIssues = yield* IssueServices.ThreadIssueService;

    expect(yield* issues.list({ state: "all" })).toEqual({
      viewers: {},
      trackers: [],
      entries: [],
      errors: [],
      nextCursors: {},
      scopes: [],
    });
    expect(yield* connections.list).toEqual({
      trackers: [],
      accounts: [],
      bindings: {},
      accountBindings: {},
    });
    for (const operation of [
      issues.detail(ref),
      issues.create({ ...ref, title: "Example", body: "", labels: [], assignees: [] }),
      issues.comment({ ...ref, body: "Example" }),
    ]) {
      expect(yield* Effect.flip(operation)).toMatchObject({
        _tag: "IssueUnavailableError",
        reason: "tracker-unsupported",
      });
    }
    for (const operation of [
      connections.connect({ tracker, token: "fixture" }),
      connections.connect({ tracker, token: null }),
      connections.bindProject({ projectId, binding: null }),
    ]) {
      expect(yield* Effect.flip(operation)).toMatchObject({
        _tag: "IssueTrackerConnectionError",
        reason: "unknown-tracker",
      });
    }
    expect(yield* Effect.flip(threadIssues.linkedThreads(ref))).toMatchObject({
      _tag: "IssueOperationError",
      operation: "linkedThreads",
    });
    expect(
      yield* Effect.flip(
        threadIssues.unlink({ threadId: ThreadId.make("fixture-thread"), key: ref }),
      ),
    ).toMatchObject({
      _tag: "OrchestratorCommandRejectedError",
      commandType: "thread.issue.unlink",
    });
  }).pipe(Effect.provide(IssueServices.layer)),
);

it.effect.each(["proof", "native"] as const)(
  "does not mistake an unavailable issue port for workflow capability in %s",
  (profile) =>
    Effect.gen(function* () {
      const forge = yield* WorkflowForge.WorkflowForge;
      expect(forge.issuesAvailable).toBe(false);
      expect(
        yield* forge.issues.list({ project: "/must-not-be-looked-up" }).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "WorkflowForgeError",
        reason: "Issues are unavailable in Paperkite.",
      });
    }).pipe(
      Effect.provide(
        WorkflowForge.layer.pipe(
          Layer.provide(IssueServices.layer),
          Layer.provide(Layer.mock(ProjectService.ProjectService)({})),
        ),
      ),
      Effect.provideService(Runtime.Profile, Runtime.status(profile)),
    ),
);

it.effect("rejects workflow issue operations before project lookup without a tracker port", () =>
  Effect.gen(function* () {
    const forge = yield* WorkflowForge.WorkflowForge;
    expect(forge.issuesAvailable).toBe(false);
    expect(WorkflowForge.unavailable.issuesAvailable).toBe(false);
    const project = "/fixture";
    const address = { project, url: "https://linear.app/fixture/issue/ENG-1" };
    for (const operation of [
      forge.issues.list({ project }),
      forge.issues.read(address),
      forge.issues.comment(address, "Example"),
      forge.issues.setState(address, "done"),
      forge.issues.create({ project, title: "Example" }),
    ]) {
      expect(yield* Effect.flip(operation)).toMatchObject({
        _tag: "WorkflowForgeError",
        reason: "Issues are unavailable in Paperkite.",
      });
    }
  }).pipe(
    Effect.provide(
      WorkflowForge.layer.pipe(Layer.provide(Layer.mock(ProjectService.ProjectService)({}))),
    ),
  ),
);
