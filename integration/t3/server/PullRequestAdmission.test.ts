import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthSourceControlWriteScope,
  EnvironmentId,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Tool, Toolkit } from "effect/ai";
import * as RpcTest from "effect/rpc/RpcTest";
import * as RpcAuthorization from "../../auth/RpcAuthorization.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as Runtime from "./Runtime.ts";

const profile = {
  application: "paperkite",
  upstreamCommit: "fixture",
  profile: "proof",
  capabilities: {
    threadSettlement: false,
    pullRequests: false,
    git: false,
    pairing: false,
    environments: false,
    github: false,
    sourceControl: false,
    issues: false,
  },
} as const;

const tested = [
  WS_METHODS.pullRequestsList,
  WS_METHODS.pullRequestsSubscribeRefreshes,
  WS_METHODS.gitRunStackedAction,
  WS_METHODS.subscribeVcsStatus,
  WS_METHODS.subscribeVcsBranch,
  WS_METHODS.peerLinksNames,
  WS_METHODS.serverProbe,
] as const;
const group = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (
      tag,
    ): tag is Exclude<keyof typeof RpcAuthorization.RPC_REQUIRED_SCOPES, (typeof tested)[number]> =>
      !(tested as ReadonlyArray<string>).includes(tag),
  ),
);

it.effect("rejects disabled PR, Git and peer RPCs before handlers or success callbacks", () =>
  Effect.gen(function* () {
    const handled: string[] = [];
    const authorized: string[] = [];
    const handlers = Layer.mergeAll(
      group.toLayerHandler(WS_METHODS.pullRequestsList, () =>
        Effect.sync(() => handled.push("list")).pipe(Effect.andThen(Effect.never)),
      ),
      group.toLayerHandler(WS_METHODS.pullRequestsSubscribeRefreshes, () =>
        Stream.fromEffect(Effect.sync(() => handled.push("subscription"))),
      ),
      group.toLayerHandler(WS_METHODS.gitRunStackedAction, () =>
        Stream.fromEffect(
          Effect.sync(() => handled.push("git")).pipe(Effect.andThen(Effect.never)),
        ),
      ),
      group.toLayerHandler(WS_METHODS.subscribeVcsStatus, () =>
        Stream.fromEffect(
          Effect.sync(() => handled.push("vcs")).pipe(
            Effect.andThen(Effect.die("Unexpected VCS subscription handler")),
          ),
        ),
      ),
      group.toLayerHandler(WS_METHODS.subscribeVcsBranch, () =>
        Stream.fromEffect(
          Effect.sync(() => handled.push("branch")).pipe(
            Effect.andThen(Effect.die("Unexpected branch subscription handler")),
          ),
        ),
      ),
      group.toLayerHandler(WS_METHODS.peerLinksNames, () =>
        Effect.sync(() => handled.push("peer")).pipe(
          Effect.andThen(Effect.die("Unexpected peer handler")),
        ),
      ),
      group.toLayerHandler(WS_METHODS.serverProbe, () => Effect.succeed({})),
    );
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(
        Layer.merge(
          handlers,
          RpcAuthorization.layer(
            [AuthOrchestrationReadScope, AuthSourceControlWriteScope],
            (method) =>
              Effect.sync(() => {
                authorized.push(method);
              }),
          ),
        ),
      ),
    );
    expect(
      yield* client[WS_METHODS.pullRequestsList]({ state: "open" }).pipe(
        Effect.provideService(Runtime.Profile, undefined),
        Effect.flip,
      ),
    ).toMatchObject({ _tag: "PullRequestUnavailableError", reason: "feature-disabled" });
    expect(
      yield* client[WS_METHODS.pullRequestsSubscribeRefreshes]({}).pipe(
        Stream.runDrain,
        Effect.flip,
      ),
    ).toMatchObject({ _tag: "PullRequestUnavailableError", reason: "feature-disabled" });
    expect(
      yield* client[WS_METHODS.gitRunStackedAction]({
        cwd: "/fixture",
        actionId: "fixture",
        action: "commit_push_pr",
      }).pipe(Stream.runDrain, Effect.flip),
    ).toMatchObject({ _tag: "PullRequestUnavailableError", reason: "feature-disabled" });
    for (const rejected of [
      client[WS_METHODS.subscribeVcsStatus]({ cwd: "/fixture" }).pipe(Stream.runDrain, Effect.flip),
      client[WS_METHODS.subscribeVcsBranch]({ cwd: "/fixture" }).pipe(Stream.runDrain, Effect.flip),
    ])
      expect(yield* rejected).toMatchObject({ _tag: "GitUnavailableError" });
    expect(yield* client[WS_METHODS.peerLinksNames]({}).pipe(Effect.flip)).toMatchObject({
      _tag: "EnvironmentFeatureUnavailableError",
      feature: "environments",
    });
    expect(yield* client[WS_METHODS.serverProbe]({})).toEqual({});
    expect(handled).toEqual([]);
    expect(authorized).toEqual([WS_METHODS.serverProbe]);

    const unprivileged = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(Layer.merge(handlers, RpcAuthorization.layer([]))),
    );
    expect(
      yield* unprivileged[WS_METHODS.pullRequestsList]({ state: "open" }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "EnvironmentAuthorizationError" });
  }).pipe(Effect.provideService(Runtime.Profile, profile)),
);

it.effect(
  "blocks excluded MCP features and Git workspaces without affecting local files or root workspaces",
  () =>
    Effect.gen(function* () {
      const handled: string[] = [];
      const options = {
        parameters: Schema.Struct({
          environmentId: OrchestratorMcpEnvironmentTarget,
          workspaceStrategy: Schema.optional(Schema.Unknown),
          isolation: Schema.optional(Schema.Literals(["shared", "worktree"])),
        }),
        success: Schema.Void,
        failure: OrchestratorMcpFailure,
        dependencies: [McpInvocationContext.McpInvocationContext],
      };
      const tools = Toolkit.make(
        Tool.make("pull_request_read", options),
        Tool.make("link_pull_requests", options),
        Tool.make("ci_rerun", options),
        Tool.make("read_file", options),
        Tool.make("create_workspace", options),
        Tool.make("t3_environment_links", options),
      );
      const record = (name: string) =>
        McpToolAccess.reads(() =>
          Effect.sync(() => {
            handled.push(name);
          }),
        );
      const layer = McpToolAccess.toLayer(tools, {
        pull_request_read: record("read"),
        link_pull_requests: record("link"),
        ci_rerun: record("rerun"),
        read_file: record("file"),
        create_workspace: record("workspace"),
        t3_environment_links: record("environments"),
      });
      const ready = yield* tools.pipe(Effect.provide(McpToolAccess.HandlersLayer.layer(layer)));
      for (const name of ["pull_request_read", "link_pull_requests", "ci_rerun"] as const) {
        for (const args of [{}, { environmentId: "remote" }]) {
          expect(
            yield* ready
              .handle(name, args)
              .pipe(
                Effect.provideService(Runtime.Profile, undefined),
                Effect.flatMap(Stream.runDrain),
                Effect.flip,
              ),
          ).toMatchObject({ _tag: "OrchestratorMcpFailure", code: "capability_denied" });
        }
      }
      for (const args of [
        { workspaceStrategy: { type: "worktree", baseRef: "main" } },
        { isolation: "worktree" as const },
      ]) {
        expect(
          yield* ready
            .handle("create_workspace", args)
            .pipe(Effect.flatMap(Stream.runDrain), Effect.flip),
        ).toMatchObject({ _tag: "OrchestratorMcpFailure", code: "capability_denied" });
      }
      expect(
        yield* ready
          .handle("t3_environment_links", {})
          .pipe(Effect.flatMap(Stream.runDrain), Effect.flip),
      ).toMatchObject({ _tag: "OrchestratorMcpFailure", code: "capability_denied" });
      expect(
        yield* ready
          .handle("read_file", { environmentId: "remote" })
          .pipe(Effect.flatMap(Stream.runDrain), Effect.flip),
      ).toMatchObject({ _tag: "OrchestratorMcpFailure", code: "capability_denied" });
      yield* ready.handle("read_file", {}).pipe(Effect.flatMap(Stream.runDrain));
      yield* ready
        .handle("create_workspace", { workspaceStrategy: { type: "root" } })
        .pipe(Effect.flatMap(Stream.runDrain));
      expect(handled).toEqual(["file", "workspace"]);
    }).pipe(
      Effect.provideService(Runtime.Profile, profile),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("local"),
        capabilities: new Set<McpInvocationContext.McpCapability>(),
        issuedAt: 0,
        requestNamespace: "fixture",
        thread: undefined,
        client: { sessionId: "fixture", label: "fixture", access: "read-only" },
        linkedEnvironments: true,
      }),
    ),
);
