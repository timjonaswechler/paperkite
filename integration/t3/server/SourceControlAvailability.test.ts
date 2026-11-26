import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  AuthSourceControlWriteScope,
  DEFAULT_SERVER_SETTINGS,
  IssueTrackerKind,
  ProjectId,
  SourceControlProviderKind,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";
import * as BuiltInDrivers from "../../sourceControl/builtInDrivers.ts";
import { sourceControlDefinitions } from "../../sourceControl/sourceControlDefinitions.ts";
import * as RpcAuthorization from "../../auth/RpcAuthorization.ts";
import * as Runtime from "./Runtime.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as SourceControlServices from "./SourceControlServices.ts";

const removed = [
  "github",
  "gitlab",
  "gitcafe",
  "tanstack-source",
  "forgejo",
  "bitbucket",
  "azure-devops",
  "cursor-origin",
  "linear",
] as const;

it.effect(
  "constructs empty product registries without host, process, settings or tracker services",
  () =>
    Effect.gen(function* () {
      expect(yield* BuiltInDrivers.SourceControlDrivers).toEqual([]);
      const registry = yield* SourceControlServices.SourceControlProviderRegistry;
      expect(yield* registry.discover).toEqual([]);
      for (const kind of removed) {
        expect(sourceControlDefinitions.find(kind)).toBeUndefined();
        expect(sourceControlDefinitions.get(kind).kind).toBe("unknown");
        expect(
          yield* registry.get(SourceControlProviderKind.make(kind)).pipe(Effect.flip),
        ).toMatchObject({ _tag: "SourceControlProviderError" });
      }
      expect(sourceControlDefinitions.definitions).toEqual([]);
      expect(yield* registry.resolve({ cwd: "/not-a-repository" }).pipe(Effect.flip)).toMatchObject(
        { _tag: "SourceControlProviderError", operation: "resolve" },
      );
      expect(
        yield* registry.resolveHandle({ cwd: "/not-a-repository" }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "SourceControlProviderError", operation: "resolveHandle" });
      expect(
        registry.resolveLink({
          cwd: "/not-a-repository",
          url: new URL("https://github.com/owner/repo"),
        }),
      ).toBeUndefined();
      const repositories = yield* SourceControlServices.SourceControlRepositoryService;
      expect(
        yield* repositories.discardClone("/must-not-be-deleted").pipe(Effect.flip),
      ).toMatchObject({ _tag: "SourceControlRepositoryError", operation: "discardClone" });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          BuiltInDrivers.layer,
          SourceControlServices.registryLayer,
          SourceControlServices.repositoryLayer,
        ),
      ),
    ),
);

it("omits all removed host settings in both client shapes without changing stored source values", () => {
  const hosts = Object.fromEntries(
    [...removed, "future-host"].map((kind) => [
      kind,
      { tokens: { "fixture.test": `fixture-${kind}-secret` }, opaqueCredential: "private" },
    ]),
  );
  const original = structuredClone(hosts);
  for (const secretReferences of [false, true]) {
    expect(
      ServerSettings.redactServerSettingsForClient(
        { ...DEFAULT_SERVER_SETTINGS, sourceControlHosts: hosts },
        { secretReferences },
      ).sourceControlHosts,
    ).toEqual({});
  }
  expect(hosts).toEqual(original);
});

const sourceControlMethods = [
  WS_METHODS.sourceControlSignInStart,
  WS_METHODS.sourceControlSignInWait,
  WS_METHODS.sourceControlSignInCancel,
  WS_METHODS.sourceControlAppAccess,
  WS_METHODS.sourceControlStarred,
  WS_METHODS.sourceControlStar,
] as const;
const tested = [
  ...sourceControlMethods,
  WS_METHODS.issuesDetail,
  WS_METHODS.issueTrackersBindProject,
  WS_METHODS.issueTrackersList,
  WS_METHODS.serverDiscoverSourceControl,
] as const;
const group = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (
      tag,
    ): tag is Exclude<keyof typeof RpcAuthorization.RPC_REQUIRED_SCOPES, (typeof tested)[number]> =>
      !(tested as ReadonlyArray<string>).includes(tag),
  ),
);

it.effect(
  "rejects every removed account/tracker RPC before handlers while preserving authorization",
  () =>
    Effect.gen(function* () {
      const handled: string[] = [];
      const forbidden = (method: string) => () =>
        Effect.sync(() => handled.push(method)).pipe(
          Effect.andThen(Effect.die(`Unexpected ${method} handler`)),
        );
      const handlers = Layer.mergeAll(
        group.toLayerHandler(WS_METHODS.sourceControlSignInStart, forbidden("start")),
        group.toLayerHandler(WS_METHODS.sourceControlSignInWait, forbidden("wait")),
        group.toLayerHandler(WS_METHODS.sourceControlSignInCancel, forbidden("cancel")),
        group.toLayerHandler(WS_METHODS.sourceControlAppAccess, forbidden("access")),
        group.toLayerHandler(WS_METHODS.sourceControlStarred, forbidden("starred")),
        group.toLayerHandler(WS_METHODS.sourceControlStar, forbidden("star")),
        group.toLayerHandler(WS_METHODS.issuesDetail, forbidden("issue")),
        group.toLayerHandler(WS_METHODS.issueTrackersBindProject, forbidden("binding")),
        group.toLayerHandler(WS_METHODS.issueTrackersList, forbidden("trackers")),
        group.toLayerHandler(WS_METHODS.serverDiscoverSourceControl, forbidden("discovery")),
      );
      for (const profile of ["proof", "native"] as const) {
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.merge(
              handlers,
              RpcAuthorization.layer([
                AuthOrchestrationReadScope,
                AuthSettingsWriteScope,
                AuthSourceControlWriteScope,
              ]),
            ),
          ),
          Effect.provideService(Runtime.Profile, Runtime.status(profile)),
        );
        for (const kind of removed) {
          const input = {
            provider: SourceControlProviderKind.make(kind),
            host: "fixture.test",
            repository: "fixture/fixture",
          };
          for (const method of sourceControlMethods) {
            expect(
              yield* client[method](input).pipe(
                Effect.provideService(Runtime.Profile, undefined),
                Effect.flip,
              ),
            ).toMatchObject({
              _tag: "EnvironmentFeatureUnavailableError",
              feature: "sourceControl",
            });
          }
          const issue = {
            projectId: ProjectId.make("fixture"),
            tracker: IssueTrackerKind.make(kind),
            host: input.host,
            scope: input.repository,
            key: "42",
          };
          expect(yield* client[WS_METHODS.issuesDetail](issue).pipe(Effect.flip)).toMatchObject({
            _tag: "EnvironmentFeatureUnavailableError",
            feature: "issues",
          });
          expect(
            yield* client[WS_METHODS.issueTrackersBindProject]({
              projectId: issue.projectId,
              binding: { tracker: issue.tracker, scope: issue.scope },
            }).pipe(Effect.flip),
          ).toMatchObject({ _tag: "EnvironmentFeatureUnavailableError", feature: "issues" });
        }
        expect(yield* client[WS_METHODS.issueTrackersList]({}).pipe(Effect.flip)).toMatchObject({
          _tag: "EnvironmentFeatureUnavailableError",
          feature: "issues",
        });
        expect(
          yield* client[WS_METHODS.serverDiscoverSourceControl]({}).pipe(Effect.flip),
        ).toMatchObject({ _tag: "EnvironmentFeatureUnavailableError", feature: "sourceControl" });
        expect(handled).toEqual([]);
      }
      const unprivileged = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(Layer.merge(handlers, RpcAuthorization.layer([]))),
      );
      expect(
        yield* unprivileged[WS_METHODS.sourceControlAppAccess]({
          provider: SourceControlProviderKind.make("github"),
          host: "fixture.test",
          repository: "fixture/fixture",
        }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "EnvironmentAuthorizationError" });
    }).pipe(Effect.provideService(Runtime.Profile, Runtime.status("proof"))),
);
