import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2DomainEvent,
  ProviderDriverKind,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as SqlClient from "effect/sql/SqlClient";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { resolveCodexRollbackTurnCount } from "./Adapters/CodexAdapterV2.ts";
import * as CheckpointRollbackService from "./CheckpointRollbackService.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";
import * as EventSink from "./EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProjectionStore from "./ProjectionStore.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";

const layerForbiddenIds = Layer.succeed(IdAllocator.IdAllocatorV2, {
  get allocate(): never {
    throw new Error("ID allocation must not run before rejection");
  },
  get derive(): never {
    throw new Error("ID derivation must not run before rejection");
  },
});

const request = {
  threadId: ThreadId.make("thread:rollback-boundary"),
  providerThreadId: ProviderThreadId.make("provider-thread:rollback-boundary"),
  checkpointId: CheckpointId.make("checkpoint:rollback-boundary"),
  scopeId: CheckpointScopeId.make("scope:rollback-boundary"),
};

it.effect.each([undefined, true])(
  "rejects file restore (restoreFiles=%s) before hydration, IDs, provider access or writes",
  (restoreFiles) =>
    Effect.gen(function* () {
      const service = yield* CheckpointRollbackService.CheckpointRollbackServiceV2;
      const error = yield* service
        .execute({
          ...request,
          ...(restoreFiles === undefined ? {} : { restoreFiles }),
        })
        .pipe(Effect.flip);
      assert.equal(error.reason, "file-restore-unavailable");
      assert.equal(error.threadId, request.threadId);
      assert.equal(error.providerThreadId, request.providerThreadId);
      assert.equal(error.checkpointId, request.checkpointId);
      assert.equal(
        CheckpointRollbackService.rollbackFailureClientMessage(error),
        "File rollback is unavailable in Paperkite.",
      );
    }).pipe(
      Effect.provide(
        CheckpointRollbackService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
              layerForbiddenIds,
              Layer.mock(EventSink.EventSinkV2)({}),
              Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({}),
              Layer.mock(RuntimePolicy.RuntimePolicyV2)({}),
              Layer.mock(ThreadCommandExecutor.ThreadCommandExecutor)({}),
            ),
          ),
        ),
      ),
    ),
);

it.effect.each([
  { invalid: "stale checkpoint", reason: "rollback-target-invalid" },
  { invalid: "wrong scope", reason: "rollback-target-invalid" },
  { invalid: "repository scope", reason: "rollback-target-invalid" },
  { invalid: "provider changed", reason: "active-provider-changed" },
  { invalid: "missing turn", reason: "provider-turn-unavailable" },
] as const)(
  "rejects conversation rollback with $invalid before opening the provider",
  ({ invalid, reason }) => {
    const providerInstanceId = ProviderInstanceId.make("provider_rollback_boundary");
    const context = {
      thread: {
        activeProviderThreadId:
          invalid === "provider changed"
            ? ProviderThreadId.make("provider-thread:other")
            : request.providerThreadId,
        modelSelection: { instanceId: providerInstanceId, model: "test" },
        deletedAt: null,
      },
      providerThread: {
        id: request.providerThreadId,
        providerSessionId: ProviderSessionId.make("session:rollback-boundary"),
        providerInstanceId,
      },
      checkpoint: {
        id: request.checkpointId,
        scopeId:
          invalid === "wrong scope" ? CheckpointScopeId.make("scope:other") : request.scopeId,
        status: invalid === "stale checkpoint" ? "stale" : "missing",
        appRunOrdinal: invalid === "missing turn" ? 2 : 0,
      },
      scope: {
        id: request.scopeId,
        ...(invalid === "repository scope" ? { repositoryPath: "/project/repository" } : {}),
      },
      providerTurns: [],
    } as unknown as ProjectionStore.ProjectionCheckpointRollbackContext;
    return Effect.gen(function* () {
      const service = yield* CheckpointRollbackService.CheckpointRollbackServiceV2;
      const error = yield* service.execute({ ...request, restoreFiles: false }).pipe(Effect.flip);
      assert.equal(error.reason, reason);
      assert.equal(
        CheckpointRollbackService.rollbackFailureClientMessage(error),
        CheckpointRollbackService.ROLLBACK_FAILED_MESSAGE,
      );
    }).pipe(
      Effect.provide(
        CheckpointRollbackService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProjectionStore.ProjectionStoreV2)({
                getCheckpointRollbackContext: () => Effect.succeed(context),
              }),
              layerForbiddenIds,
              Layer.mock(EventSink.EventSinkV2)({}),
              Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({}),
              Layer.mock(RuntimePolicy.RuntimePolicyV2)({}),
              Layer.mock(ThreadCommandExecutor.ThreadCommandExecutor)({}),
            ),
          ),
        ),
      ),
    );
  },
);

const seedRollbackHistory = Effect.gen(function* () {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const now = yield* DateTime.now;
  const threadId = ThreadId.make("rollback-history");
  const providerThreadId = ProviderThreadId.make("rollback-history-provider");
  const providerSessionId = ProviderSessionId.make("rollback-history-session");
  const providerInstanceId = ProviderInstanceId.make("codex");
  const driver = ProviderDriverKind.make("codex");
  const modelSelection = { instanceId: providerInstanceId, model: "test" };
  const scopeId = CheckpointScopeId.make("rollback-history-root");
  const otherScopeId = CheckpointScopeId.make("rollback-history-child");
  const repositoryScopeId = CheckpointScopeId.make("rollback-history-repository");
  const runId = (ordinal: number) => RunId.make(`rollback-history-run-${ordinal}`);
  const nodeId = (ordinal: number) => NodeId.make(`rollback-history-node-${ordinal}`);
  const attemptId = (ordinal: number) => RunAttemptId.make(`rollback-history-attempt-${ordinal}`);
  const turnId = (ordinal: number) => ProviderTurnId.make(`rollback-history-turn-${ordinal}`);
  const checkpointId = (ordinal: number) =>
    CheckpointId.make(`rollback-history-checkpoint-${ordinal}`);
  type EventInput<Event = OrchestrationV2DomainEvent> = Event extends OrchestrationV2DomainEvent
    ? Omit<Event, "id" | "occurredAt" | "threadId">
    : never;
  let sequence = 0;
  const apply = (event: EventInput) =>
    store.apply({
      ...event,
      id: EventId.make(`rollback-history-event-${sequence++}`),
      threadId,
      occurredAt: now,
    } as OrchestrationV2DomainEvent);
  yield* apply({
    type: "thread.created",
    payload: {
      id: threadId,
      createdBy: "user",
      creationSource: "web",
      projectId: ProjectId.make("rollback-history-project"),
      title: "Rollback history",
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: process.cwd(),
      activeProviderThreadId: providerThreadId,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
  const providerThread = {
    id: providerThreadId,
    driver,
    providerInstanceId,
    providerSessionId,
    appThreadId: threadId,
    ownerNodeId: null,
    nativeThreadRef: null,
    nativeConversationHeadRef: null,
    status: "idle" as const,
    firstRunOrdinal: 1,
    lastRunOrdinal: 6,
    handoffIds: [],
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
  };
  yield* apply({ type: "provider-thread.updated", payload: providerThread });
  for (const id of [scopeId, otherScopeId]) {
    yield* apply({
      type: "checkpoint-scope.created",
      payload: {
        id,
        threadId,
        runId: runId(1),
        nodeId: nodeId(1),
        parentScopeId: id === scopeId ? null : scopeId,
        providerThreadId,
        kind: id === scopeId ? "root_run" : "subagent",
        ordinalWithinParent: 0,
        advancesAppRunCount: id === scopeId,
        cwd: process.cwd(),
        createdAt: now,
      },
    });
  }
  const statuses = [
    "completed",
    "completed",
    "completed",
    "interrupted",
    "failed",
    "cancelled",
    "rolled_back",
  ] as const;
  for (const [index, status] of statuses.entries()) {
    const ordinal = index + 1;
    yield* apply({
      type: "run.created",
      payload: {
        id: runId(ordinal),
        threadId,
        ordinal,
        providerInstanceId,
        modelSelection,
        providerThreadId,
        userMessageId: MessageId.make(`rollback-history-message-${ordinal}`),
        rootNodeId: nodeId(ordinal),
        activeAttemptId: attemptId(ordinal),
        status,
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        checkpointId: checkpointId(ordinal),
        contextHandoffId: null,
      },
    });
    yield* apply({
      type: "node.updated",
      payload: {
        id: nodeId(ordinal),
        threadId,
        runId: runId(ordinal),
        parentNodeId: null,
        rootNodeId: nodeId(ordinal),
        kind: "root_turn",
        status,
        countsForRun: true,
        providerThreadId,
        providerTurnId: turnId(ordinal),
        nativeItemRef: null,
        runtimeRequestId: null,
        checkpointScopeId: scopeId,
        startedAt: now,
        completedAt: now,
      },
    });
    // Rollback must exclude every attempt of discarded runs, including an inactive retry.
    for (const attemptOrdinal of ordinal === 7 ? [6.5, 7] : [ordinal]) {
      yield* apply({
        type: "run-attempt.created",
        runId: runId(ordinal),
        payload: {
          id: attemptId(attemptOrdinal),
          runId: runId(ordinal),
          attemptOrdinal: attemptOrdinal === ordinal ? 2 : 1,
          rootNodeId: nodeId(ordinal),
          providerInstanceId,
          providerThreadId,
          providerTurnId: turnId(attemptOrdinal),
          reason: "initial",
          status: "completed",
          startedAt: now,
          completedAt: now,
        },
      });
      yield* apply({
        type: "provider-turn.updated",
        payload: {
          id: turnId(attemptOrdinal),
          providerThreadId,
          nodeId: nodeId(ordinal),
          runAttemptId: attemptId(attemptOrdinal),
          nativeTurnRef: { driver, nativeId: `native-turn-${attemptOrdinal}`, strength: "strong" },
          ordinal: attemptOrdinal * 2,
          status: status === "rolled_back" ? "completed" : status,
          startedAt: now,
          completedAt: now,
        },
      });
    }
  }
  // A continuation shares the target attempt; its first provider turn is no longer the boundary.
  yield* apply({
    type: "provider-turn.updated",
    payload: {
      id: turnId(2.5),
      providerThreadId,
      nodeId: nodeId(2),
      runAttemptId: attemptId(2),
      nativeTurnRef: { driver, nativeId: "native-turn-2-continuation", strength: "strong" },
      ordinal: 5,
      status: "completed",
      startedAt: now,
      completedAt: now,
    },
  });
  for (let ordinal = 0; ordinal <= 8; ordinal++) {
    yield* apply({
      type: "checkpoint.captured",
      payload: {
        id: checkpointId(ordinal),
        threadId,
        scopeId: ordinal === 8 ? otherScopeId : scopeId,
        runId: ordinal === 0 ? null : runId(Math.min(ordinal, 7)),
        nodeId: nodeId(Math.max(1, Math.min(ordinal, 7))),
        parentCheckpointId: null,
        ordinalWithinScope: ordinal,
        appRunOrdinal: ordinal === 0 ? null : ordinal,
        ref: CheckpointRef.make(`refs/t3/rollback-history/${ordinal}`),
        status: ordinal === 7 ? "stale" : "ready",
        files: [],
        capturedAt: now,
      },
    });
  }

  // A tracked repository records only the turns that changed it: runs 2 and 4 here.
  yield* apply({
    type: "checkpoint-scope.created",
    payload: {
      id: repositoryScopeId,
      threadId,
      runId: runId(2),
      nodeId: nodeId(2),
      parentScopeId: scopeId,
      providerThreadId,
      kind: "manual",
      ordinalWithinParent: 1,
      advancesAppRunCount: false,
      cwd: process.cwd(),
      label: "api",
      repositoryPath: process.cwd(),
      createdAt: now,
    },
  });
  for (const ordinal of [2, 4]) {
    yield* apply({
      type: "checkpoint.captured",
      payload: {
        id: CheckpointId.make(`rollback-history-repository-checkpoint-${ordinal}`),
        threadId,
        scopeId: repositoryScopeId,
        runId: runId(ordinal),
        nodeId: nodeId(ordinal),
        parentCheckpointId: null,
        ordinalWithinScope: ordinal,
        appRunOrdinal: null,
        ref: CheckpointRef.make(`refs/t3/rollback-history/repository/${ordinal}`),
        status: "ready",
        files: [],
        capturedAt: now,
      },
    });
  }

  const rollbackCounts: number[] = [];
  const committed: OrchestrationV2DomainEvent[] = [];
  const serviceLayer = CheckpointRollbackService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ThreadCommandExecutor.layer,
        IdAllocator.layer,
        Layer.mock(EventSink.EventSinkV2)({
          write: ({ events }) =>
            Effect.gen(function* () {
              for (const event of events) yield* store.apply(event);
              committed.push(...events);
              return [];
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new EventSink.EventSinkWriteError({
                    eventCount: events.length,
                    cause,
                  }),
              ),
            ),
        }),
        Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
          open: () =>
            Effect.succeed({
              rollbackThread: (input: ProviderAdapter.ProviderAdapterV2RollbackThreadInput) =>
                Effect.gen(function* () {
                  rollbackCounts.push(yield* resolveCodexRollbackTurnCount(input));
                  return { providerThread: input.providerThread };
                }),
            } as never),
        }),
        Layer.mock(RuntimePolicy.RuntimePolicyV2)({ resolve: () => Effect.succeed({} as never) }),
      ),
    ),
  );
  const rollback = (ordinal: number, restoreFiles = false) =>
    Effect.gen(function* () {
      const service = yield* CheckpointRollbackService.CheckpointRollbackServiceV2;
      yield* service.execute({
        threadId,
        providerThreadId,
        scopeId,
        checkpointId: checkpointId(ordinal),
        ...(restoreFiles === undefined ? {} : { restoreFiles }),
      });
    }).pipe(Effect.provide(serviceLayer));

  return {
    store,
    now,
    threadId,
    runId,
    nodeId,
    checkpointId,
    rollback,
    rollbackCounts,
    repositoryScopeId,
    committed,
  };
});

it.layer(ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)))(
  "rollback history reads",
  (it) => {
    it.effect("rolls back later terminal runs despite obsolete unrelated SQLite payloads", () =>
      Effect.gen(function* () {
        const history = yield* seedRollbackHistory;
        const sql = yield* SqlClient.SqlClient;
        const { threadId, runId, nodeId, checkpointId } = history;
        yield* sql`
          INSERT INTO orchestration_v2_projection_turn_items (
            turn_item_id, thread_id, run_id, node_id, provider_thread_id, provider_turn_id,
            parent_item_id, ordinal, type, status, updated_at, payload_json
          ) VALUES ('rollback-obsolete-transcript', ${threadId}, ${runId(1)}, ${nodeId(1)},
            NULL, NULL, NULL, 1, 'assistant_message', 'completed', ${DateTime.formatIso(history.now)},
            '{"obsolete":"transcript"}')`;
        yield* sql`UPDATE orchestration_v2_projection_runs
          SET payload_json = '{"obsolete":"run"}' WHERE run_id = ${runId(1)}`;
        yield* sql`UPDATE orchestration_v2_projection_nodes
          SET payload_json = '{"obsolete":"node"}' WHERE node_id = ${nodeId(1)}`;
        yield* sql`UPDATE orchestration_v2_projection_checkpoints
          SET payload_json = json_set(payload_json, '$.files', 'obsolete file summary')
          WHERE checkpoint_id IN (${checkpointId(0)}, ${checkpointId(1)}, ${checkpointId(7)}, ${checkpointId(8)})`;
        assert.equal(
          (yield* Effect.exit(history.store.getThreadProjection(threadId)))._tag,
          "Failure",
        );

        yield* history.rollback(2);

        assert.deepEqual(history.rollbackCounts, [4]);
        const runs = yield* sql<{ ordinal: number; status: string }>`
          SELECT ordinal, status FROM orchestration_v2_projection_runs
          WHERE thread_id = ${threadId} ORDER BY ordinal`;
        assert.deepEqual(
          runs.map((run) => run.status),
          [
            "completed",
            "completed",
            "rolled_back",
            "rolled_back",
            "rolled_back",
            "rolled_back",
            "rolled_back",
          ],
        );
        const nodes = yield* sql<{ status: string }>`
          SELECT status FROM orchestration_v2_projection_nodes
          WHERE thread_id = ${threadId} ORDER BY node_id`;
        assert.deepEqual(
          nodes.map((node) => node.status),
          runs.map((run) => run.status),
        );
        const checkpoints = yield* sql<{ status: string }>`
          SELECT status FROM orchestration_v2_projection_checkpoints
          WHERE thread_id = ${threadId} AND scope_id != ${history.repositoryScopeId}
          ORDER BY ordinal_within_scope`;
        assert.deepEqual(
          checkpoints.map((checkpoint) => checkpoint.status),
          ["ready", "ready", "ready", "stale", "stale", "stale", "stale", "stale", "ready"],
        );
        // Historical repository records are invalidated, not deleted or restored.
        const repositoryCheckpoints = yield* sql<{ status: string }>`
          SELECT status FROM orchestration_v2_projection_checkpoints
          WHERE scope_id = ${history.repositoryScopeId} ORDER BY ordinal_within_scope`;
        assert.deepEqual(
          repositoryCheckpoints.map((checkpoint) => checkpoint.status),
          ["ready", "stale"],
        );
      }),
    );

    it.effect.each(["missing", "error"] as const)(
      "rewinds the conversation to a %s checkpoint without file services",
      (status) =>
        Effect.gen(function* () {
          const history = yield* seedRollbackHistory;
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE orchestration_v2_projection_checkpoints
          SET status = ${status}, payload_json = json_set(payload_json, '$.status', ${status})
          WHERE checkpoint_id = ${history.checkpointId(2)}`;

          yield* history.rollback(2, false);

          assert.deepEqual(history.rollbackCounts, [4]);
        }),
    );

    it.effect(
      "rewinds stopped runs repeatedly without counting discarded provider turns again",
      () =>
        Effect.gen(function* () {
          const history = yield* seedRollbackHistory;
          yield* history.rollback(5);
          yield* history.rollback(2);
          yield* history.rollback(0);
          yield* history.rollback(0);

          assert.deepEqual(history.rollbackCounts, [1, 3, 3]);
          assert.sameMembers(
            history.committed
              .filter((event) => event.type === "run.updated")
              .map((event) => event.payload.id),
            [1, 2, 3, 4, 5, 6].map(history.runId),
          );
          const records = yield* history.store.getThreadRecords(history.threadId, [
            "runs",
            "nodes",
            "checkpoints",
          ]);
          assert.isTrue(records.runs.every((run) => run.status === "rolled_back"));
          assert.isTrue(records.nodes.every((node) => node.status === "rolled_back"));
          assert.sameMembers(
            records.checkpoints
              .filter((checkpoint) => checkpoint.status === "ready")
              .map((checkpoint) => checkpoint.id),
            [history.checkpointId(0), history.checkpointId(8)],
          );
        }),
    );

    it.effect("skips a pending rollback once the thread is deleted", () =>
      Effect.gen(function* () {
        const history = yield* seedRollbackHistory;
        const thread = yield* history.store.getThread(history.threadId);
        yield* history.store.apply({
          id: EventId.make("rollback-history-deleted"),
          type: "thread.deleted",
          threadId: history.threadId,
          providerInstanceId: thread.providerInstanceId,
          occurredAt: history.now,
          payload: { ...thread, deletedAt: history.now, updatedAt: history.now },
        });

        yield* history.rollback(2);

        assert.deepEqual(history.rollbackCounts, []);
        assert.deepEqual(history.committed, []);
      }),
    );
  },
);
