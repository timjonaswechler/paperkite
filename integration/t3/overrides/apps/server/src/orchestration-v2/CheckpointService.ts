import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  OrchestrationV2Checkpoint,
  OrchestrationV2CheckpointScope,
  type OrchestrationV2AppThread,
  type ProjectId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";

const CHECKPOINT_REFS_PREFIX = "refs/t3/orchestration-v2/checkpoints";
const ROOT_CHECKPOINT_SCOPE_NAME = "root";
const REPOSITORY_SCOPE_CONCURRENCY = 6;

export class CheckpointRootScopePrepareError extends Schema.TaggedError<CheckpointRootScopePrepareError>()(
  "CheckpointRootScopePrepareError",
  {
    threadId: ThreadId,
    runId: RunId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to prepare root checkpoint scope for run ${this.runId}.`;
  }
}

export class CheckpointBaselineCaptureError extends Schema.TaggedError<CheckpointBaselineCaptureError>()(
  "CheckpointBaselineCaptureError",
  {
    scopeId: CheckpointScopeId,
    ordinalWithinScope: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to capture checkpoint baseline ${this.ordinalWithinScope} for scope ${this.scopeId}.`;
  }
}

export class CheckpointCaptureError extends Schema.TaggedError<CheckpointCaptureError>()(
  "CheckpointCaptureError",
  {
    scopeId: CheckpointScopeId,
    parentCheckpointId: Schema.optional(CheckpointId),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to capture checkpoint for scope ${this.scopeId}.`;
  }
}

export class CheckpointRestoreError extends Schema.TaggedError<CheckpointRestoreError>()(
  "CheckpointRestoreError",
  {
    scopeId: CheckpointScopeId,
    checkpointId: CheckpointId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to restore checkpoint ${this.checkpointId} for scope ${this.scopeId}.`;
  }
}

export class CheckpointDeleteStaleRefsError extends Schema.TaggedError<CheckpointDeleteStaleRefsError>()(
  "CheckpointDeleteStaleRefsError",
  {
    scopeId: CheckpointScopeId,
    checkpointIds: Schema.Array(CheckpointId),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to delete stale checkpoint refs for scope ${this.scopeId}.`;
  }
}

export class CheckpointRestoreUnavailableError extends Schema.TaggedError<CheckpointRestoreUnavailableError>()(
  "CheckpointRestoreUnavailableError",
  { scopeId: CheckpointScopeId },
) {
  override get message(): string {
    return "Checkpoint restore is unavailable because Git snapshots are disabled.";
  }
}

export const CheckpointServiceV2Error = Schema.Union([
  CheckpointRestoreUnavailableError,
  CheckpointRootScopePrepareError,
  CheckpointBaselineCaptureError,
  CheckpointCaptureError,
  CheckpointRestoreError,
  CheckpointDeleteStaleRefsError,
]);
export type CheckpointServiceV2Error = typeof CheckpointServiceV2Error.Type;

/** Per scope, the other scopes' folders inside its own: relative, `/`-separated. */
type NestedScopePaths = ReadonlyMap<CheckpointScopeId, ReadonlyArray<string>>;

/** Relative folders to exclude for a diff of previously stored checkpoints. */
export const nestedScopePaths = Effect.fn("CheckpointService.nestedScopePaths")(function* (
  scopes: ReadonlyArray<Pick<OrchestrationV2CheckpointScope, "id" | "cwd">>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolved = yield* Effect.forEach(
    scopes,
    (scope) =>
      fileSystem.realPath(scope.cwd).pipe(
        Effect.orElseSucceed(() => path.resolve(scope.cwd)),
        Effect.map((cwd) => ({ id: scope.id, cwd })),
      ),
    { concurrency: REPOSITORY_SCOPE_CONCURRENCY },
  );
  const nested = new Map<CheckpointScopeId, ReadonlyArray<string>>();
  for (const outer of resolved) {
    const inside = resolved.flatMap((inner) => {
      const relative = path.relative(outer.cwd, inner.cwd);
      return relative === "" ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
        ? []
        : [relative.split(path.sep).join("/")];
    });
    if (inside.length === 0) continue;
    const excluded = [...new Set(inside)];
    if (excluded.length > 0) nested.set(outer.id, excluded);
  }
  return nested as NestedScopePaths;
});

export interface CheckpointServiceV2Shape {
  readonly prepareRootRunScope: (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
    readonly rootNodeId: NodeId;
    readonly providerThreadId: ProviderThreadId;
    readonly cwd: string;
    readonly createdAt: DateTime.Utc;
  }) => Effect.Effect<OrchestrationV2CheckpointScope, CheckpointServiceV2Error>;
  /**
   * One scope per tracked Git folder the thread reaches now, under its root scope. Ids depend only
   * on the thread and the tracked path, so every run names the same scope. Empty when the folders
   * cannot be read: the thread then runs with its root scope alone.
   */
  readonly repositoryScopes: (input: {
    readonly rootScope: OrchestrationV2CheckpointScope;
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  }) => Effect.Effect<ReadonlyArray<OrchestrationV2CheckpointScope>>;
  /** As `repositoryScopes`, but null when the folders cannot be read: a rewind must not guess. */
  readonly repositoryScopesIfReadable: (input: {
    readonly rootScope: OrchestrationV2CheckpointScope;
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  }) => Effect.Effect<ReadonlyArray<OrchestrationV2CheckpointScope> | null>;
  readonly nestedScopePaths: (
    scopes: ReadonlyArray<Pick<OrchestrationV2CheckpointScope, "id" | "cwd">>,
  ) => Effect.Effect<NestedScopePaths>;
  readonly captureBaseline: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly ordinalWithinScope: number;
    /**
     * Also baselines the tracked repositories this thread reaches, a few at a time and all within
     * one budget, so many repositories delay a turn no longer than one. A repository that misses
     * the budget has no baseline this turn.
     */
    readonly thread?: Pick<OrchestrationV2AppThread, "projectId" | "worktreePath">;
  }) => Effect.Effect<void, CheckpointServiceV2Error>;
  readonly materializeBaselineCheckpoint: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly ordinalWithinScope: number;
    /** The run materializing the baseline: its root node, and when it was requested. */
    readonly nodeId: NodeId;
    readonly capturedAt: DateTime.Utc;
    /** Records a missing checkpoint without touching git, for side chats sharing a parent's worktree. */
    readonly forceMissing?: boolean;
  }) => Effect.Effect<OrchestrationV2Checkpoint, CheckpointServiceV2Error>;
  readonly capture: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly runId: RunId | null;
    readonly nodeId: NodeId;
    readonly ordinalWithinScope: number;
    readonly appRunOrdinal: number | null;
    readonly capturedAt: DateTime.Utc;
    readonly forceMissing?: boolean;
    readonly excludePaths?: ReadonlyArray<string>;
    /** `capturesSoFar` from before an earlier wait on the folder's lock, when there was one. */
    readonly capturesBeforeLock?: number;
  }) => Effect.Effect<OrchestrationV2Checkpoint, CheckpointServiceV2Error>;
  /** How many captures have finished in a folder, for a caller that waits on it before `capture`. */
  readonly capturesSoFar: (cwd: string) => Effect.Effect<number>;
  /**
   * A tracked repository's checkpoint for a run, with the baseline before it unless that is
   * already recorded. None when the run left the repository as it found it, which costs one
   * status and writes nothing: a project can track dozens of repositories a turn never touches.
   */
  readonly captureRepository: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly runId: RunId;
    readonly nodeId: NodeId;
    readonly ordinalWithinScope: number;
    readonly capturedAt: DateTime.Utc;
    readonly baselineCapturedAt: DateTime.Utc;
    readonly baselineRecorded: boolean;
    readonly excludePaths?: ReadonlyArray<string>;
  }) => Effect.Effect<
    Option.Option<{
      readonly baseline: OrchestrationV2Checkpoint | null;
      readonly checkpoint: OrchestrationV2Checkpoint;
    }>,
    CheckpointServiceV2Error
  >;
  /**
   * Restores a thread's folders together. Every snapshot is checked before a folder changes and
   * each folder is snapshotted first, so a restore that fails puts back the ones already
   * restored: a rewind changes all of them or none.
   */
  readonly restore: (input: {
    readonly targets: ReadonlyArray<{
      readonly scope: Pick<OrchestrationV2CheckpointScope, "id" | "cwd">;
      readonly checkpoint: Pick<OrchestrationV2Checkpoint, "ordinalWithinScope" | "ref" | "status">;
    }>;
    /** Every folder of the thread with checkpoints of its own; a restore leaves the others' alone. */
    readonly scopes: ReadonlyArray<Pick<OrchestrationV2CheckpointScope, "id" | "cwd">>;
  }) => Effect.Effect<void, CheckpointServiceV2Error>;
  readonly deleteStaleRefs: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly checkpoints: ReadonlyArray<OrchestrationV2Checkpoint>;
  }) => Effect.Effect<void, CheckpointServiceV2Error>;
  /**
   * Drops the snapshots the thread's tracked repositories took at these run ordinals. A rollback
   * reuses the ordinals, and a snapshot left behind would pass for a later turn's baseline. Most
   * have no checkpoint record, so they are found by ordinal.
   */
  readonly discardRepositorySnapshots: (input: {
    readonly rootScope: OrchestrationV2CheckpointScope;
    readonly thread: Pick<OrchestrationV2AppThread, "projectId" | "worktreePath">;
    readonly ordinals: ReadonlyArray<number>;
  }) => Effect.Effect<void, CheckpointServiceV2Error>;
}

export class CheckpointServiceV2 extends Context.Service<
  CheckpointServiceV2,
  CheckpointServiceV2Shape
>()("t3/orchestration-v2/CheckpointService/CheckpointServiceV2") {}

const scopeRef = Effect.fnUntraced(function* (scopeId: CheckpointScopeId, name: string) {
  const crypto = yield* Digest.Digest;
  const digest = yield* crypto
    .digest(Digest.sha256, new TextEncoder().encode(scopeId))
    .pipe(Effect.orDie);
  const scopeKey = Hex.encode(digest).slice(0, 32);
  return CheckpointRef.make(`${CHECKPOINT_REFS_PREFIX}/${Base64Url.encode(scopeKey)}/${name}`);
});

export const checkpointRefForScopeOrdinal = Effect.fn("checkpointRefForScopeOrdinal")(
  (input: { readonly scopeId: CheckpointScopeId; readonly ordinalWithinScope: number }) =>
    scopeRef(input.scopeId, `ordinal/${input.ordinalWithinScope}`),
);

function checkpointIdForScopeOrdinal(
  idAllocator: IdAllocator.IdAllocatorV2["Service"],
  input: {
    readonly scopeId: CheckpointScopeId;
    readonly ordinalWithinScope: number;
  },
) {
  return idAllocator.allocate.checkpoint({
    checkpointScopeId: input.scopeId,
    name: String(input.ordinalWithinScope),
  });
}

const makeRootRunScope = Effect.fn("CheckpointService.makeRootRunScope")(function* (input: {
  readonly idAllocator: IdAllocator.IdAllocatorV2["Service"];
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly rootNodeId: NodeId;
  readonly providerThreadId: ProviderThreadId;
  readonly cwd: string;
  readonly createdAt: DateTime.Utc;
}) {
  const scopeId = yield* input.idAllocator.allocate.checkpointScope({
    threadId: input.threadId,
    name: ROOT_CHECKPOINT_SCOPE_NAME,
  });
  return {
    id: scopeId,
    threadId: input.threadId,
    runId: input.runId,
    nodeId: input.rootNodeId,
    parentScopeId: null,
    providerThreadId: input.providerThreadId,
    kind: "root_run",
    ordinalWithinParent: 0,
    advancesAppRunCount: true,
    cwd: input.cwd,
    createdAt: input.createdAt,
  } satisfies OrchestrationV2CheckpointScope;
});

function makeCheckpoint(input: {
  readonly id: CheckpointId;
  readonly scope: OrchestrationV2CheckpointScope;
  readonly runId: RunId | null;
  readonly nodeId: NodeId;
  readonly parentCheckpointId: CheckpointId | null;
  readonly ordinalWithinScope: number;
  readonly appRunOrdinal: number | null;
  readonly ref: CheckpointRef;
  readonly status: OrchestrationV2Checkpoint["status"];
  readonly files: OrchestrationV2Checkpoint["files"];
  readonly capturedAt: DateTime.Utc;
}): OrchestrationV2Checkpoint {
  return {
    id: input.id,
    threadId: input.scope.threadId,
    scopeId: input.scope.id,
    runId: input.runId,
    nodeId: input.nodeId,
    parentCheckpointId: input.parentCheckpointId,
    ordinalWithinScope: input.ordinalWithinScope,
    appRunOrdinal: input.appRunOrdinal,
    ref: input.ref,
    status: input.status,
    files: input.files,
    capturedAt: input.capturedAt,
  };
}

// Keep native run ordering and lineage without ever probing, creating or restoring Git snapshots.
export const layer = Layer.effect(
  CheckpointServiceV2,
  Effect.gen(function* () {
    const idAllocator = yield* IdAllocator.IdAllocatorV2;
    const missing = Effect.fn("Paperkite.CheckpointService.missing")(function* (
      input: Parameters<CheckpointServiceV2Shape["capture"]>[0],
    ) {
      const id = yield* checkpointIdForScopeOrdinal(idAllocator, {
        scopeId: input.scope.id,
        ordinalWithinScope: input.ordinalWithinScope,
      });
      const parentCheckpointId =
        input.ordinalWithinScope > 0
          ? yield* checkpointIdForScopeOrdinal(idAllocator, {
              scopeId: input.scope.id,
              ordinalWithinScope: input.ordinalWithinScope - 1,
            })
          : null;
      return makeCheckpoint({
        ...input,
        id,
        parentCheckpointId,
        ref: CheckpointRef.make(`paperkite:no-snapshot:${id}`),
        status: "missing",
        files: [],
      });
    });
    return CheckpointServiceV2.of({
      prepareRootRunScope: Effect.fn("Paperkite.CheckpointService.prepareRootRunScope")((input) =>
        makeRootRunScope({ ...input, idAllocator }).pipe(
          Effect.mapError(
            (cause) =>
              new CheckpointRootScopePrepareError({
                threadId: input.threadId,
                runId: input.runId,
                cause,
              }),
          ),
        ),
      ),
      repositoryScopes: Effect.fn("Paperkite.CheckpointService.repositoryScopes")(() =>
        Effect.succeed([]),
      ),
      repositoryScopesIfReadable: Effect.fn(
        "Paperkite.CheckpointService.repositoryScopesIfReadable",
      )(() => Effect.succeed([])),
      nestedScopePaths: Effect.fn("Paperkite.CheckpointService.nestedScopePaths")(() =>
        Effect.succeed(new Map()),
      ),
      captureBaseline: Effect.fn("Paperkite.CheckpointService.captureBaseline")(() => Effect.void),
      materializeBaselineCheckpoint: Effect.fn(
        "Paperkite.CheckpointService.materializeBaselineCheckpoint",
      )((input) =>
        missing({ ...input, runId: null, appRunOrdinal: null }).pipe(
          Effect.mapError(
            (cause) =>
              new CheckpointBaselineCaptureError({
                scopeId: input.scope.id,
                ordinalWithinScope: input.ordinalWithinScope,
                cause,
              }),
          ),
        ),
      ),
      capture: Effect.fn("Paperkite.CheckpointService.capture")((input) =>
        missing(input).pipe(
          Effect.mapError(
            (cause) => new CheckpointCaptureError({ scopeId: input.scope.id, cause }),
          ),
        ),
      ),
      capturesSoFar: Effect.fn("Paperkite.CheckpointService.capturesSoFar")(() =>
        Effect.succeed(0),
      ),
      captureRepository: Effect.fn("Paperkite.CheckpointService.captureRepository")((input) =>
        Effect.fail(
          new CheckpointCaptureError({
            scopeId: input.scope.id,
            cause: "Git snapshots are disabled.",
          }),
        ),
      ),
      restore: Effect.fn("Paperkite.CheckpointService.restore")(function* (input) {
        const target = input.targets[0];
        if (target === undefined) return;
        return yield* new CheckpointRestoreUnavailableError({ scopeId: target.scope.id });
      }),
      deleteStaleRefs: Effect.fn("Paperkite.CheckpointService.deleteStaleRefs")(function* (input) {
        if (input.checkpoints.some((checkpoint) => checkpoint.status === "ready"))
          return yield* new CheckpointDeleteStaleRefsError({
            scopeId: input.scope.id,
            checkpointIds: input.checkpoints.map((checkpoint) => checkpoint.id),
            cause: "Git snapshots are disabled; existing refs are left untouched.",
          });
      }),
      discardRepositorySnapshots: Effect.fn(
        "Paperkite.CheckpointService.discardRepositorySnapshots",
      )(function* ({ rootScope, ordinals }) {
        if (ordinals.length > 0) {
          return yield* new CheckpointDeleteStaleRefsError({
            scopeId: rootScope.id,
            checkpointIds: [],
            cause: "Existing repository snapshots are retained.",
          });
        }
      }),
    });
  }),
);
