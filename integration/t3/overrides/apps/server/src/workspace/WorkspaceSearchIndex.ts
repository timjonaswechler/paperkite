import * as NodeWorkerThreads from "node:worker_threads";
import type {
  ProjectEntry,
  ProjectEntryKind,
  ProjectListEntriesResult,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isProjectFaviconPath } from "@t3tools/shared/projectFavicon";
import { scoreSubsequenceMatch } from "@t3tools/shared/searchRanking";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as WorkspaceFilePolicy from "../paperkite/integration/WorkspaceFilePolicy.ts";
import * as Protocol from "../paperkite/integration/WorkspaceSearchProtocol.ts";
import { source as workerSource } from "../paperkite/integration/WorkspaceSearchWorker.ts";
import {
  compilePathQuery,
  splitContentQuery,
} from "../paperkite/integration/WorkspaceSearchQuery.ts";

export const WORKSPACE_INDEX_IDLE_TTL = "15 minutes";
const SCAN_TIMEOUT = "15 seconds";
const SNAPSHOT_TTL_MS = 2_000;
const MAX_INDEX_ENTRIES = 100_000;
const MAX_LIST_ENTRIES = 25_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const decodeResponse = Schema.decodeUnknownEffect(Protocol.Response);

type Entry = ProjectEntry & { readonly symlink?: boolean };
type Snapshot = { readonly entries: ReadonlyArray<Entry>; readonly truncated: boolean };

export class WorkspaceSearchIndexCreateFailed extends Schema.TaggedError<WorkspaceSearchIndexCreateFailed>()(
  "WorkspaceSearchIndexCreateFailed",
  {
    cwd: Schema.String,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to create the workspace search index for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexScanTimedOut extends Schema.TaggedError<WorkspaceSearchIndexScanTimedOut>()(
  "WorkspaceSearchIndexScanTimedOut",
  {
    cwd: Schema.String,
    timeout: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace search index for '${this.cwd}' did not finish scanning within ${this.timeout}`;
  }
}

export class WorkspaceSearchIndexSearchFailed extends Schema.TaggedError<WorkspaceSearchIndexSearchFailed>()(
  "WorkspaceSearchIndexSearchFailed",
  {
    cwd: Schema.String,
    queryLength: Schema.Number,
    pageSize: Schema.Number,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Workspace search failed for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexRefreshFailed extends Schema.TaggedError<WorkspaceSearchIndexRefreshFailed>()(
  "WorkspaceSearchIndexRefreshFailed",
  {
    cwd: Schema.String,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to refresh the workspace search index for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexDestroyFailed extends Schema.TaggedError<WorkspaceSearchIndexDestroyFailed>()(
  "WorkspaceSearchIndexDestroyFailed",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to destroy the workspace search index for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndex extends Context.Service<
  WorkspaceSearchIndex,
  {
    readonly list: () => Effect.Effect<ProjectListEntriesResult, WorkspaceSearchIndexSearchFailed>;
    readonly search: (
      query: string,
      limit: number,
      kind?: ProjectEntryKind,
      imageOnly?: boolean,
    ) => Effect.Effect<ProjectSearchEntriesResult, WorkspaceSearchIndexSearchFailed>;
    readonly searchContents: (
      input: Omit<ProjectSearchContentsInput, "cwd">,
    ) => Effect.Effect<
      ProjectSearchContentsResult,
      WorkspaceSearchIndexScanTimedOut | WorkspaceSearchIndexSearchFailed
    >;
    readonly refresh: () => Effect.Effect<void, WorkspaceSearchIndexRefreshFailed>;
  }
>()("t3/workspace/WorkspaceSearchIndex") {}

export const make = Effect.fn("WorkspaceSearchIndex.make")(function* (
  cwd: string,
  _variant: WorkspaceSearchIndexVariant = "paths",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Effect.scope;
  const root = yield* fs.realPath(cwd).pipe(
    Effect.mapError(
      (cause) =>
        new WorkspaceSearchIndexCreateFailed({
          cwd,
          reason: "Workspace root is unreadable.",
          cause,
        }),
    ),
  );
  const home = yield* HostProcess.HomeDirectory;
  if (root === path.resolve(home)) {
    return yield* new WorkspaceSearchIndexCreateFailed({
      cwd,
      reason: "The home directory cannot be indexed.",
    });
  }
  const relative = (absolute: string) => path.relative(root, absolute).split(path.sep).join("/");
  const withinRoot = (absolute: string) => {
    const value = relative(absolute);
    return (
      value !== ".." &&
      !value.startsWith("../") &&
      !path.isAbsolute(value) &&
      !value.split("/").includes(".git")
    );
  };
  const searchError = (cause: unknown, queryLength = 0, pageSize = 0) =>
    new WorkspaceSearchIndexSearchFailed({
      cwd,
      queryLength,
      pageSize,
      reason: "Workspace search could not complete.",
      cause,
    });
  const workers = new Set<NodeWorkerThreads.Worker>();
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      yield* Effect.forEach(
        workers,
        (worker) =>
          Effect.tryPromise({
            try: () => worker.terminate(),
            catch: (cause) => new WorkspaceSearchIndexDestroyFailed({ cwd, cause }),
          }),
        { concurrency: 2 },
      ).pipe(Effect.orDie);
      workers.clear();
    }),
  );
  const isMissing = (error: { readonly reason: { readonly _tag: string } }) =>
    error.reason._tag === "NotFound";

  // This hot-path resolver is covered by its enclosing scan/read span.
  const resolveLink = Effect.fnUntraced(function* (entry: Entry) {
    const absolute = path.join(root, entry.path);
    const target = yield* fs
      .realPath(absolute)
      .pipe(Effect.timeoutOption("1 second"), Effect.option);
    if (Option.isNone(target) || Option.isNone(target.value) || !withinRoot(target.value.value))
      return undefined;
    const real = target.value.value;
    const stat = yield* fs.stat(absolute).pipe(Effect.timeoutOption("1 second"), Effect.option);
    if (Option.isNone(stat) || Option.isNone(stat.value)) return undefined;
    const info = stat.value.value;
    if (info.type !== "File" && info.type !== "Directory") return undefined;
    const parent = path.dirname(absolute);
    if (info.type === "Directory" && (parent === real || parent.startsWith(`${real}${path.sep}`)))
      return undefined;
    return {
      ...entry,
      kind: info.type === "Directory" ? ("directory" as const) : ("file" as const),
    };
  });
  const policyContext =
    yield* Effect.context<Effect.Services<ReturnType<typeof WorkspaceFilePolicy.make>>>();
  const makePolicy = WorkspaceFilePolicy.make(root).pipe(Effect.provideContext(policyContext));
  const scan = Effect.fn("WorkspaceSearchIndex.scan")(function* () {
    const policy = yield* makePolicy;
    const entries: Entry[] = [];
    const directories = [""];
    let examined = 0;
    let truncated = false;
    while (directories.length > 0 && !truncated) {
      const directory = directories.pop()!;
      const absolute = path.join(root, directory);
      const real = yield* fs
        .realPath(absolute)
        .pipe(Effect.catchIf(isMissing, () => Effect.undefined));
      if (!real || !withinRoot(real) || real !== absolute) continue;
      const children = yield* fs
        .readDirectoryEntries(absolute)
        .pipe(Effect.catchIf(isMissing, () => Effect.succeed([])));
      for (let offset = 0; offset < children.length; offset += 256) {
        if (examined >= MAX_INDEX_ENTRIES) {
          truncated = true;
          break;
        }
        const batch = children.slice(offset, offset + Math.min(256, MAX_INDEX_ENTRIES - examined));
        examined += batch.length;
        const candidates = yield* Effect.forEach(
          batch,
          (child) =>
            Effect.gen(function* () {
              if (child.name === ".git") return undefined;
              const entryPath = directory ? `${directory}/${child.name}` : child.name;
              let type = child.type;
              if (type === "Unknown") {
                const info = yield* fs
                  .lstat(path.join(root, entryPath))
                  .pipe(Effect.catchIf(isMissing, () => Effect.undefined));
                if (!info) return undefined;
                type = info.type;
              }
              if (type === "SymbolicLink")
                return yield* resolveLink({ path: entryPath, kind: "file", symlink: true });
              if (type !== "File" && type !== "Directory") return undefined;
              return {
                path: entryPath,
                kind: type === "Directory" ? ("directory" as const) : ("file" as const),
              };
            }),
          { concurrency: 16 },
        );
        const present = candidates.filter((entry) => entry !== undefined);
        const ignored = yield* policy.ignored(present, "search");
        for (const entry of present) {
          if (ignored.has(entry.path)) continue;
          if (entries.length >= MAX_INDEX_ENTRIES) {
            truncated = true;
            break;
          }
          entries.push(entry);
          // Folder aliases remain entries; descending them duplicates results and permits cycles.
          if (entry.kind === "directory" && !("symlink" in entry)) directories.push(entry.path);
        }
        if (
          examined >= MAX_INDEX_ENTRIES &&
          (offset + batch.length < children.length || directories.length > 0)
        )
          truncated = true;
        if (truncated) break;
        yield* Effect.yieldNow;
      }
    }
    return {
      entries: entries.toSorted((a, b) => a.path.localeCompare(b.path)),
      truncated,
    } satisfies Snapshot;
  });

  let snapshot: Snapshot | undefined;
  let expiresAt = 0;
  let pending: Deferred.Deferred<Snapshot, WorkspaceSearchIndexSearchFailed> | undefined;
  let lastScanError: WorkspaceSearchIndexSearchFailed | undefined;
  const startScan = Effect.fn("WorkspaceSearchIndex.startScan")(function* () {
    if (pending) return pending;
    const done = yield* Deferred.make<Snapshot, WorkspaceSearchIndexSearchFailed>();
    pending = done;
    yield* scan().pipe(
      Effect.timeoutOrElse({
        duration: "60 seconds",
        orElse: () =>
          Effect.fail(searchError(new Error("Workspace scan exceeded its time budget"))),
      }),
      Effect.mapError((cause) => searchError(cause)),
      Effect.tap((value) =>
        Effect.gen(function* () {
          snapshot = value;
          expiresAt = (yield* Clock.currentTimeMillis) + SNAPSHOT_TTL_MS;
          lastScanError = undefined;
        }),
      ),
      Effect.tapError((error) =>
        Effect.sync(() => {
          lastScanError = error;
        }),
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          pending = undefined;
        }).pipe(Effect.andThen(Deferred.done(done, exit))),
      ),
      Effect.forkIn(scope),
    );
    return done;
  });
  const current = Effect.fn("WorkspaceSearchIndex.current")(function* () {
    if (closed) return yield* searchError(new Error("Workspace search index is closed"));
    if (lastScanError) return yield* lastScanError;
    const done =
      !snapshot || (yield* Clock.currentTimeMillis) >= expiresAt ? yield* startScan() : pending;
    const value =
      snapshot ??
      (yield* Deferred.await(done!).pipe(
        Effect.timeoutOrElse({
          duration: SCAN_TIMEOUT,
          orElse: () =>
            Effect.fail(new WorkspaceSearchIndexScanTimedOut({ cwd, timeout: SCAN_TIMEOUT })),
        }),
      ));
    // Re-evaluate current metadata even while a slower rescan is using the previous snapshot.
    const policy = yield* makePolicy.pipe(Effect.mapError((cause) => searchError(cause)));
    const ignored = yield* policy
      .ignored(value.entries, "search")
      .pipe(Effect.mapError((cause) => searchError(cause)));
    const entries = yield* Effect.forEach(
      value.entries.filter((entry) => !ignored.has(entry.path)),
      (entry) => (entry.symlink ? resolveLink(entry) : Effect.succeed(entry)),
      { concurrency: 16 },
    );
    return { ...value, entries: entries.filter((entry) => entry !== undefined) };
  });
  const list: WorkspaceSearchIndex["Service"]["list"] = Effect.fn("WorkspaceSearchIndex.list")(
    function* () {
      const value = yield* current().pipe(Effect.mapError((cause) => searchError(cause)));
      return {
        entries: value.entries.slice(0, MAX_LIST_ENTRIES).map(({ path, kind }) => ({ path, kind })),
        truncated: value.truncated || value.entries.length > MAX_LIST_ENTRIES,
      };
    },
  );
  const search: WorkspaceSearchIndex["Service"]["search"] = Effect.fn(
    "WorkspaceSearchIndex.search",
  )(function* (query, limit, kind, imageOnly) {
    const value = yield* current().pipe(
      Effect.mapError((cause) => searchError(cause, query.length, limit)),
    );
    const compiled = yield* Effect.try({
      try: () => compilePathQuery(query),
      catch: (cause) => searchError(cause, query.length, limit),
    });
    const eligible = value.entries.filter((entry) =>
      imageOnly
        ? entry.kind === "file" && isProjectFaviconPath(entry.path)
        : kind === undefined || kind === entry.kind,
    );
    const ranked: Array<{ entry: Entry; score: number }> = [];
    for (let offset = 0; offset < eligible.length; offset += 256) {
      for (const entry of eligible.slice(offset, offset + 256)) {
        if (!compiled.accepts(entry.path, entry.kind === "directory")) continue;
        let score = 0;
        let matched = true;
        for (const token of compiled.fuzzy) {
          const next = scoreSubsequenceMatch(entry.path.toLowerCase(), token);
          if (next === null) {
            matched = false;
            break;
          }
          score += next;
        }
        if (matched) ranked.push({ entry, score });
      }
      yield* Effect.yieldNow;
    }
    if (ranked.length === 0 && compiled.literalFallback) {
      for (const entry of eligible) {
        const score = scoreSubsequenceMatch(entry.path.toLowerCase(), compiled.literalFallback);
        if (score !== null) ranked.push({ entry, score });
      }
    }
    ranked.sort((a, b) => a.score - b.score || a.entry.path.localeCompare(b.entry.path));
    return {
      entries: ranked.slice(0, limit).map(({ entry: { path, kind } }) => ({ path, kind })),
      truncated: value.truncated || ranked.length > limit,
    };
  });

  const contentSlots = yield* Semaphore.make(2);
  const searchContents: WorkspaceSearchIndex["Service"]["searchContents"] = Effect.fn(
    "WorkspaceSearchIndex.searchContents",
  )(
    function* (input) {
      const value = yield* current();
      const parsed = yield* Effect.try({
        try: () => splitContentQuery(input.query),
        catch: (cause) => searchError(cause, input.query.length, input.limit),
      });
      const responses = yield* Queue.bounded<unknown, WorkspaceSearchIndexSearchFailed>(2);
      yield* Effect.addFinalizer(() => Queue.shutdown(responses));
      const worker = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            if (closed) throw new Error("Workspace search index is closed");
            const worker = new NodeWorkerThreads.Worker(workerSource, {
              eval: true,
              workerData: { ...input, query: parsed.text },
              resourceLimits: { maxOldGenerationSizeMb: 64 },
            });
            const fail = (cause: unknown) =>
              Queue.failCauseUnsafe(
                responses,
                Cause.fail(searchError(cause, input.query.length, input.limit)),
              );
            worker.on("message", (value: unknown) => Queue.offerUnsafe(responses, value));
            worker.once("error", fail);
            worker.once("exit", (code) =>
              fail(new Error(`Workspace search worker exited with code ${code}`)),
            );
            workers.add(worker);
            return worker;
          },
          catch: (cause) => searchError(cause, input.query.length, input.limit),
        }),
        (worker) =>
          Effect.tryPromise({
            try: () => {
              workers.delete(worker);
              return worker.terminate();
            },
            catch: (cause) => new WorkspaceSearchIndexDestroyFailed({ cwd, cause }),
          }).pipe(Effect.orDie),
      );
      const receive = Queue.take(responses).pipe(
        Effect.flatMap(decodeResponse),
        Effect.mapError((cause) => searchError(cause, input.query.length, input.limit)),
      );
      const ready = yield* receive.pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () =>
            Effect.fail(
              searchError(
                new Error("Workspace search worker did not start"),
                input.query.length,
                input.limit,
              ),
            ),
        }),
      );
      const policy = yield* makePolicy.pipe(Effect.mapError((cause) => searchError(cause)));
      const deadline = (yield* Clock.currentTimeMillis) + 1_000;
      const matches: Array<ProjectSearchContentsResult["matches"][number]> = [];
      let truncated = value.truncated;
      let regexFallbackError = ready.regexFallbackError;
      for (const entry of value.entries) {
        if (entry.kind !== "file" || !parsed.paths.accepts(entry.path, false) || !parsed.text)
          continue;
        if ((yield* Clock.currentTimeMillis) >= deadline) {
          truncated = true;
          break;
        }
        const absolute = path.join(root, entry.path);
        const real = yield* fs.realPath(absolute).pipe(
          Effect.catchIf(isMissing, () => Effect.undefined),
          Effect.mapError((cause) => searchError(cause)),
        );
        if (!real || !withinRoot(real)) continue;
        const info = yield* fs.stat(absolute).pipe(
          Effect.catchIf(isMissing, () => Effect.undefined),
          Effect.mapError((cause) => searchError(cause)),
        );
        if (!info || info.type !== "File") continue;
        if (
          entry.symlink &&
          (yield* policy
            .ignored([{ path: relative(real), kind: "file" }], "search")
            .pipe(Effect.mapError((cause) => searchError(cause)))).size > 0
        )
          continue;
        const bytes = yield* Effect.scoped(
          Effect.gen(function* () {
            const file = yield* fs.open(absolute, { flag: "r" });
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (size <= MAX_FILE_BYTES) {
              const chunk = yield* file.readAlloc(Math.min(64 * 1024, MAX_FILE_BYTES + 1 - size));
              if (Option.isNone(chunk)) break;
              chunks.push(chunk.value);
              size += chunk.value.length;
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.length;
            }
            return bytes;
          }),
        ).pipe(
          Effect.catchIf(isMissing, () => Effect.undefined),
          Effect.mapError((cause) => searchError(cause)),
        );
        if (!bytes) continue;
        if (bytes.length > MAX_FILE_BYTES) {
          truncated = true;
          continue;
        }
        yield* Effect.try({
          try: () => worker.postMessage({ path: entry.path, bytes }, [bytes.buffer]),
          catch: (cause) => searchError(cause),
        });
        const response = yield* receive.pipe(
          Effect.timeoutOrElse({
            duration: "250 millis",
            orElse: () =>
              Effect.fail(
                new WorkspaceSearchIndexSearchFailed({
                  cwd,
                  queryLength: input.query.length,
                  pageSize: input.limit,
                  reason: "Content matching exceeded its per-file time budget.",
                }),
              ),
          }),
        );
        if (response.type !== "result")
          return yield* searchError(new Error("Unexpected workspace search worker response"));
        regexFallbackError ??= response.regexFallbackError;
        matches.push(...response.matches);
        truncated ||= response.truncated;
        if (matches.length > input.limit) {
          truncated = true;
          break;
        }
      }
      return {
        matches: matches.slice(0, input.limit),
        truncated,
        ...(regexFallbackError ? { regexFallbackError } : {}),
      };
    },
    Effect.scoped,
    contentSlots.withPermits(1),
    Effect.timeoutOrElse({
      duration: "30 seconds",
      orElse: () =>
        Effect.fail(searchError(new Error("Workspace content search exceeded its time budget"))),
    }),
  );
  const refresh: WorkspaceSearchIndex["Service"]["refresh"] = Effect.fn(
    "WorkspaceSearchIndex.refresh",
  )(function* () {
    if (closed)
      return yield* new WorkspaceSearchIndexRefreshFailed({
        cwd,
        reason: "Workspace search index is closed.",
      });
    lastScanError = undefined;
    const done = yield* startScan();
    yield* Deferred.await(done).pipe(
      Effect.timeoutOption(SCAN_TIMEOUT),
      Effect.mapError(
        (cause) =>
          new WorkspaceSearchIndexRefreshFailed({ cwd, reason: "Workspace rescan failed.", cause }),
      ),
    );
  });
  return WorkspaceSearchIndex.of({ list, search, searchContents, refresh });
});

export const WORKSPACE_SEARCH_INDEX_VARIANTS = ["paths", "content"] as const;
export type WorkspaceSearchIndexVariant = (typeof WORKSPACE_SEARCH_INDEX_VARIANTS)[number];

export const workspaceSearchIndexKey = (cwd: string, variant: WorkspaceSearchIndexVariant) =>
  `${variant}\n${cwd}`;

function parseWorkspaceSearchIndexKey(key: string): {
  readonly cwd: string;
  readonly variant: WorkspaceSearchIndexVariant;
} {
  const separatorIndex = key.indexOf("\n");
  return {
    variant: key.slice(0, separatorIndex) as WorkspaceSearchIndexVariant,
    cwd: key.slice(separatorIndex + 1),
  };
}

/** @public */
export const layer = (key: string) => {
  const { cwd, variant } = parseWorkspaceSearchIndexKey(key);
  return Layer.effect(WorkspaceSearchIndex, make(cwd, variant));
};

export class WorkspaceSearchIndexMap extends LayerMap.Service<WorkspaceSearchIndexMap>()(
  "t3/workspace/WorkspaceSearchIndexMap",
  {
    lookup: layer,
    idleTimeToLive: WORKSPACE_INDEX_IDLE_TTL,
  },
) {}
