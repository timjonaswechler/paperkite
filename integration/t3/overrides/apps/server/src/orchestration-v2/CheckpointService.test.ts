import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  ProjectId,
  ProviderThreadId,
  RunId,
  ThreadId,
  type OrchestrationV2CheckpointScope,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as CheckpointService from "./CheckpointService.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";

// No filesystem, workspace-folder or checkpoint-store service is available to this layer.
const layerTest = CheckpointService.layer.pipe(Layer.provide(IdAllocator.layer));
const scope: OrchestrationV2CheckpointScope = {
  id: CheckpointScopeId.make("checkpoint-scope:no-snapshot"),
  threadId: ThreadId.make("thread:no-snapshot"),
  runId: RunId.make("run:no-snapshot:1"),
  nodeId: NodeId.make("node:no-snapshot:1"),
  parentScopeId: null,
  providerThreadId: ProviderThreadId.make("provider-thread:no-snapshot"),
  kind: "root_run",
  ordinalWithinParent: 0,
  advancesAppRunCount: true,
  cwd: "/unreadable/project/vendor/nested",
  createdAt: DateTime.makeUnsafe("2026-07-28T00:00:00.000Z"),
};

it.effect("keeps one root scope per thread across runs without inspecting the folder", () =>
  Effect.gen(function* () {
    const checkpoints = yield* CheckpointService.CheckpointServiceV2;
    const first = yield* checkpoints.prepareRootRunScope({
      threadId: scope.threadId,
      runId: scope.runId!,
      rootNodeId: scope.nodeId,
      providerThreadId: scope.providerThreadId!,
      cwd: scope.cwd,
      createdAt: scope.createdAt,
    });
    const second = yield* checkpoints.prepareRootRunScope({
      threadId: scope.threadId,
      runId: RunId.make("run:no-snapshot:2"),
      rootNodeId: NodeId.make("node:no-snapshot:2"),
      providerThreadId: ProviderThreadId.make("provider-thread:no-snapshot:2"),
      cwd: "/another/plain-folder",
      createdAt: DateTime.add(scope.createdAt, { seconds: 7 }),
    });
    const otherThread = yield* checkpoints.prepareRootRunScope({
      threadId: ThreadId.make("thread:no-snapshot:other"),
      runId: scope.runId!,
      rootNodeId: scope.nodeId,
      providerThreadId: scope.providerThreadId!,
      cwd: scope.cwd,
      createdAt: scope.createdAt,
    });
    assert.equal(first.id, second.id);
    assert.notEqual(first.id, otherThread.id);
    assert.deepEqual(second, {
      ...first,
      runId: RunId.make("run:no-snapshot:2"),
      nodeId: NodeId.make("node:no-snapshot:2"),
      providerThreadId: ProviderThreadId.make("provider-thread:no-snapshot:2"),
      cwd: "/another/plain-folder",
      createdAt: DateTime.add(scope.createdAt, { seconds: 7 }),
    });
    assert.equal(first.kind, "root_run");
    assert.equal(first.parentScopeId, null);
    assert.equal(first.ordinalWithinParent, 0);
    assert.isTrue(first.advancesAppRunCount);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "preserves missing-checkpoint identity, order and lineage across out-of-order retries",
  () =>
    Effect.gen(function* () {
      const checkpoints = yield* CheckpointService.CheckpointServiceV2;
      const capture = (ordinal: number) =>
        checkpoints.capture({
          scope,
          runId: RunId.make(`run:no-snapshot:${ordinal}`),
          nodeId: NodeId.make(`node:no-snapshot:${ordinal}`),
          ordinalWithinScope: ordinal,
          appRunOrdinal: ordinal,
          capturedAt: scope.createdAt,
        });
      const third = yield* capture(3);
      const baseline = yield* checkpoints.materializeBaselineCheckpoint({
        scope,
        ordinalWithinScope: 0,
        nodeId: scope.nodeId,
        capturedAt: scope.createdAt,
      });
      const first = yield* capture(1);
      const second = yield* capture(2);
      assert.deepEqual(yield* capture(3), third);
      assert.equal(baseline.parentCheckpointId, null);
      assert.equal(baseline.runId, null);
      assert.equal(baseline.appRunOrdinal, null);
      assert.deepEqual(
        [first, second, third].map((checkpoint) => checkpoint.parentCheckpointId),
        [baseline.id, first.id, second.id],
      );
      for (const [index, checkpoint] of [baseline, first, second, third].entries()) {
        assert.equal(checkpoint.status, "missing");
        assert.deepEqual(checkpoint.files, []);
        assert.equal(checkpoint.threadId, scope.threadId);
        assert.equal(checkpoint.scopeId, scope.id);
        assert.equal(checkpoint.ordinalWithinScope, index);
        assert.deepEqual(checkpoint.capturedAt, scope.createdAt);
        assert.isFalse(checkpoint.ref.startsWith("refs/"));
        if (index > 0) {
          assert.equal(checkpoint.runId, RunId.make(`run:no-snapshot:${index}`));
          assert.equal(checkpoint.nodeId, NodeId.make(`node:no-snapshot:${index}`));
          assert.equal(checkpoint.appRunOrdinal, index);
        }
      }
      const other = yield* checkpoints.capture({
        scope: { ...scope, id: CheckpointScopeId.make("scope:other") },
        runId: first.runId,
        nodeId: first.nodeId,
        ordinalWithinScope: 1,
        appRunOrdinal: 1,
        capturedAt: scope.createdAt,
      });
      assert.notEqual(other.id, first.id);
      assert.notEqual(other.ref, first.ref);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("never discovers or snapshots tracked or nested repositories", () =>
  Effect.gen(function* () {
    const checkpoints = yield* CheckpointService.CheckpointServiceV2;
    const thread = { projectId: ProjectId.make("project:no-snapshot"), worktreePath: scope.cwd };
    yield* checkpoints.captureBaseline({ scope, ordinalWithinScope: 0, thread });
    assert.deepEqual(yield* checkpoints.repositoryScopes({ rootScope: scope, ...thread }), []);
    assert.deepEqual(
      yield* checkpoints.repositoryScopesIfReadable({ rootScope: scope, ...thread }),
      [],
    );
    assert.deepEqual(
      yield* checkpoints.nestedScopePaths([
        scope,
        { id: CheckpointScopeId.make("scope:nested"), cwd: `${scope.cwd}/vendor/lib` },
      ]),
      new Map(),
    );
    assert.equal(yield* checkpoints.capturesSoFar(scope.cwd), 0);
    const error = yield* checkpoints
      .captureRepository({
        scope,
        runId: scope.runId!,
        nodeId: scope.nodeId,
        ordinalWithinScope: 1,
        capturedAt: scope.createdAt,
        baselineCapturedAt: scope.createdAt,
        baselineRecorded: false,
      })
      .pipe(Effect.flip);
    assert.instanceOf(error, CheckpointService.CheckpointCaptureError);
    assert.equal(error.scopeId, scope.id);
  }).pipe(Effect.provide(layerTest)),
);

it.effect.each(["ready", "missing", "error"] as const)(
  "rejects file restore to a %s checkpoint without filesystem or Git services",
  (status) =>
    Effect.gen(function* () {
      const checkpoints = yield* CheckpointService.CheckpointServiceV2;
      const error = yield* checkpoints
        .restore({
          targets: [
            {
              scope,
              checkpoint: { ordinalWithinScope: 2, ref: CheckpointRef.make("refs/legacy"), status },
            },
          ],
          scopes: [scope],
        })
        .pipe(Effect.flip);
      assert.instanceOf(error, CheckpointService.CheckpointRestoreUnavailableError);
      assert.equal(error.scopeId, scope.id);
      yield* checkpoints.restore({ targets: [], scopes: [scope] });
    }).pipe(Effect.provide(layerTest)),
);

it.effect("leaves historical refs untouched rather than claiming snapshot cleanup succeeded", () =>
  Effect.gen(function* () {
    const checkpoints = yield* CheckpointService.CheckpointServiceV2;
    const missing = yield* checkpoints.materializeBaselineCheckpoint({
      scope,
      ordinalWithinScope: 0,
      nodeId: scope.nodeId,
      capturedAt: scope.createdAt,
    });
    yield* checkpoints.deleteStaleRefs({ scope, checkpoints: [missing] });
    const ready = {
      ...missing,
      id: CheckpointId.make("checkpoint:legacy"),
      status: "ready" as const,
    };
    const deletion = yield* checkpoints
      .deleteStaleRefs({ scope, checkpoints: [ready] })
      .pipe(Effect.flip);
    assert.instanceOf(deletion, CheckpointService.CheckpointDeleteStaleRefsError);
    assert.deepEqual(deletion.checkpointIds, [ready.id]);
    const discard = yield* checkpoints
      .discardRepositorySnapshots({
        rootScope: scope,
        thread: { projectId: ProjectId.make("project:no-snapshot"), worktreePath: null },
        ordinals: [2, 5],
      })
      .pipe(Effect.flip);
    assert.instanceOf(discard, CheckpointService.CheckpointDeleteStaleRefsError);
    yield* checkpoints.discardRepositorySnapshots({
      rootScope: scope,
      thread: { projectId: ProjectId.make("project:no-snapshot"), worktreePath: null },
      ordinals: [],
    });
  }).pipe(Effect.provide(layerTest)),
);
