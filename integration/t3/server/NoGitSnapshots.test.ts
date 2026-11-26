import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointScopeId,
  NodeId,
  ProjectId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import * as CheckpointService from "../../orchestration-v2/CheckpointService.ts";
import * as CheckpointRollback from "../../orchestration-v2/CheckpointRollbackService.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as ProviderSessionManager from "../../orchestration-v2/ProviderSessionManager.ts";
import * as RuntimePolicy from "../../orchestration-v2/RuntimePolicy.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import * as WorkspaceFolders from "../../workspace/WorkspaceFolders.ts";
import * as Runtime from "./Runtime.ts";
import * as RunFinalization from "../../orchestration-v2/RunFinalizationService.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as WorkspaceEntries from "../../workspace/WorkspaceEntries.ts";

const profile = Layer.succeed(Runtime.Profile, {
  application: "paperkite",
  upstreamCommit: "fixture",
  profile: "proof",
  capabilities: {
    git: false,
    pullRequests: false,
    threadSettlement: false,
    pairing: false,
    environments: false,
    github: false,
    sourceControl: false,
    issues: false,
  },
});

const checkpointLayer = (allocator = IdAllocator.layer) =>
  Layer.fresh(CheckpointService.layer).pipe(
    Layer.provide(
      Layer.mergeAll(
        allocator,
        // Any accidental snapshot or repository probe dies through the unimplemented mock method.
        Layer.mock(CheckpointStore.CheckpointStore)({}),
        Layer.mock(WorkspaceFolders.WorkspaceFolders)({}),
        FileSystem.layerNoop({
          access: () => Effect.die("Unexpected checkpoint filesystem probe"),
          exists: () => Effect.die("Unexpected checkpoint filesystem probe"),
          realPath: () => Effect.die("Unexpected checkpoint filesystem probe"),
          stat: () => Effect.die("Unexpected checkpoint filesystem probe"),
          readFileString: () => Effect.die("Unexpected checkpoint filesystem probe"),
          readDirectory: () => Effect.die("Unexpected checkpoint filesystem probe"),
        }),
        Path.layer,
      ),
    ),
    Layer.provide(NodeCrypto.layer),
    Layer.provide(profile),
  );

it.effect("rejects file rollback and its legacy default before accessing rollback state", () =>
  Effect.gen(function* () {
    const service = yield* CheckpointRollback.CheckpointRollbackServiceV2;
    const target = {
      threadId: ThreadId.make("file-rollback-thread"),
      providerThreadId: ProviderThreadId.make("file-rollback-provider-thread"),
      checkpointId: CheckpointId.make("file-rollback-checkpoint"),
      scopeId: CheckpointScopeId.make("file-rollback-scope"),
    };
    for (const input of [target, { ...target, restoreFiles: true }]) {
      const error = yield* service.execute(input).pipe(Effect.flip);
      expect(error).toMatchObject({ reason: "file-restore-unavailable" });
      expect(CheckpointRollback.rollbackFailureClientMessage(error)).toBe(
        "File rollback is unavailable in Paperkite.",
      );
    }
  }).pipe(
    Effect.provide(
      CheckpointRollback.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
            Layer.mock(EventSink.EventSinkV2)({}),
            IdAllocator.layer.pipe(Layer.provide(NodeCrypto.layer)),
            Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({}),
            Layer.mock(RuntimePolicy.RuntimePolicyV2)({}),
            ThreadCommandExecutor.layer,
          ),
        ),
      ),
    ),
  ),
);

it.effect("refreshes ordinary files after a turn without VCS or repository enrichment", () =>
  Effect.gen(function* () {
    const refreshed = yield* Ref.make<ReadonlyArray<string>>([]);
    const observerLayer = RunFinalization.layerObserver.pipe(
      Layer.provide(
        Layer.mock(WorkspaceEntries.WorkspaceEntries)({
          refresh: (cwd) => Ref.update(refreshed, (paths) => [...paths, cwd]),
        }),
      ),
      Layer.provide(profile),
    );
    yield* Effect.gen(function* () {
      const observer = yield* RunFinalization.RunFinalizationObserver;
      const threadId = ThreadId.make("no-git-thread");
      yield* observer.refresh({ cwd: "/fixture/documents", threadId, runId: RunId.make("run") });
    }).pipe(Effect.provide(observerLayer));
    expect(yield* Ref.get(refreshed)).toEqual(["/fixture/documents"]);
  }),
);

it.effect("preserves run lineage without any repository or snapshot I/O", () =>
  Effect.gen(function* () {
    const service = yield* CheckpointService.CheckpointServiceV2;
    const createdAt = DateTime.makeUnsafe("2026-07-28T00:00:00.000Z");
    const rootInput = {
      threadId: ThreadId.make("no-git-thread"),
      runId: RunId.make("no-git-run-1"),
      rootNodeId: NodeId.make("no-git-node-1"),
      providerThreadId: ProviderThreadId.make("no-git-provider-thread"),
      cwd: "/fixture/repository",
      createdAt,
    };
    const scope = yield* service.prepareRootRunScope(rootInput);
    const thread = { projectId: ProjectId.make("no-git-project"), worktreePath: null };
    expect(yield* service.repositoryScopes({ rootScope: scope, ...thread })).toEqual([]);
    expect(yield* service.repositoryScopesIfReadable({ rootScope: scope, ...thread })).toEqual([]);
    yield* service.captureBaseline({ scope, ordinalWithinScope: 0, thread });
    const baseline = yield* service.materializeBaselineCheckpoint({
      scope,
      ordinalWithinScope: 0,
      nodeId: scope.nodeId!,
      capturedAt: createdAt,
    });
    const first = yield* service.capture({
      scope,
      ordinalWithinScope: 1,
      runId: scope.runId,
      nodeId: scope.nodeId!,
      appRunOrdinal: 1,
      capturedAt: createdAt,
    });
    const second = yield* service.capture({
      scope,
      ordinalWithinScope: 2,
      runId: RunId.make("no-git-run-2"),
      nodeId: NodeId.make("no-git-node-2"),
      appRunOrdinal: 2,
      capturedAt: createdAt,
    });
    expect(baseline).toMatchObject({
      status: "missing",
      files: [],
      runId: null,
      parentCheckpointId: null,
    });
    expect(first).toMatchObject({
      status: "missing",
      files: [],
      runId: "no-git-run-1",
      appRunOrdinal: 1,
      parentCheckpointId: baseline.id,
    });
    expect(second).toMatchObject({
      status: "missing",
      files: [],
      runId: "no-git-run-2",
      appRunOrdinal: 2,
      parentCheckpointId: first.id,
    });
    expect(new Set([baseline.id, first.id, second.id]).size).toBe(3);
    expect(
      yield* service.materializeBaselineCheckpoint({
        scope,
        ordinalWithinScope: 1,
        nodeId: scope.nodeId!,
        capturedAt: createdAt,
      }),
    ).toMatchObject({ id: first.id, status: "missing", files: [] });
    yield* service.deleteStaleRefs({ scope, checkpoints: [baseline, first, second] });
    expect(
      yield* service
        .discardRepositorySnapshots({ rootScope: scope, thread, ordinals: [1, 2] })
        .pipe(Effect.flip),
    ).toMatchObject({ _tag: "CheckpointDeleteStaleRefsError" });
    expect(yield* service.capturesSoFar(scope.cwd)).toBe(0);

    expect(
      yield* service
        .restore({
          targets: [{ scope, checkpoint: first }],
          scopes: [scope],
        })
        .pipe(Effect.flip),
    ).toMatchObject({ _tag: "CheckpointRestoreUnavailableError" });
    expect(
      yield* service
        .deleteStaleRefs({
          scope,
          checkpoints: [{ ...first, status: "ready" }],
        })
        .pipe(Effect.flip),
    ).toMatchObject({ _tag: "CheckpointDeleteStaleRefsError" });

    let allocations = 0;
    const scopeFailure = new IdAllocator.IdAllocatorV2AllocationError({ kind: "checkpoint_scope" });
    const checkpointFailure = new IdAllocator.IdAllocatorV2AllocationError({ kind: "checkpoint" });
    const failingAllocator = Layer.effect(
      IdAllocator.IdAllocatorV2,
      Effect.map(IdAllocator.IdAllocatorV2, (allocator) => ({
        ...allocator,
        allocate: {
          ...allocator.allocate,
          checkpointScope: () =>
            Effect.sync(() => {
              allocations++;
            }).pipe(Effect.andThen(Effect.fail(scopeFailure))),
          checkpoint: () =>
            Effect.sync(() => {
              allocations++;
            }).pipe(Effect.andThen(Effect.fail(checkpointFailure))),
        },
      })),
    ).pipe(Layer.provide(IdAllocator.layer));
    yield* Effect.gen(function* () {
      const failing = yield* CheckpointService.CheckpointServiceV2;
      expect(yield* failing.prepareRootRunScope(rootInput).pipe(Effect.flip)).toMatchObject({
        _tag: "CheckpointRootScopePrepareError",
        threadId: rootInput.threadId,
        runId: rootInput.runId,
        cause: scopeFailure,
      });
      expect(
        yield* failing
          .materializeBaselineCheckpoint({
            scope,
            ordinalWithinScope: 0,
            nodeId: rootInput.rootNodeId,
            capturedAt: createdAt,
          })
          .pipe(Effect.flip),
      ).toMatchObject({
        _tag: "CheckpointBaselineCaptureError",
        scopeId: scope.id,
        ordinalWithinScope: 0,
        cause: checkpointFailure,
      });
      expect(
        yield* failing
          .capture({
            scope,
            ordinalWithinScope: 1,
            nodeId: rootInput.rootNodeId,
            runId: rootInput.runId,
            appRunOrdinal: 1,
            capturedAt: createdAt,
          })
          .pipe(Effect.flip),
      ).toMatchObject({
        _tag: "CheckpointCaptureError",
        scopeId: scope.id,
        cause: checkpointFailure,
      });
      expect(
        yield* failing
          .restore({ targets: [{ scope, checkpoint: first }], scopes: [scope] })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "CheckpointRestoreUnavailableError", scopeId: scope.id });
      expect(allocations).toBe(3);
    }).pipe(Effect.provide(checkpointLayer(failingAllocator)));
  }).pipe(Effect.provide(checkpointLayer())),
);
