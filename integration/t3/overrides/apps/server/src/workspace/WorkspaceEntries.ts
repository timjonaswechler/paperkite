// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as RcMap from "effect/RcMap";
import * as Schema from "effect/Schema";

import type {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  ProjectEntry,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectListIgnoredFilesInput,
  ProjectListIgnoredFilesResult,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isExplicitRelativePath, isWindowsAbsolutePath } from "@t3tools/shared/path";
import { normalizeSearchQuery } from "@t3tools/shared/searchRanking";

import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as WorkspaceFilePolicy from "../paperkite/integration/WorkspaceFilePolicy.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
import * as WorkspaceSearchIndex from "./WorkspaceSearchIndex.ts";

export class WorkspaceEntriesWindowsPathUnsupportedError extends Schema.TaggedError<WorkspaceEntriesWindowsPathUnsupportedError>()(
  "WorkspaceEntriesWindowsPathUnsupportedError",
  {
    cwd: Schema.optional(Schema.String),
    partialPath: Schema.String,
    platform: Schema.String,
  },
) {
  override get message(): string {
    const cwd = this.cwd ? ` from '${this.cwd}'` : "";
    return `Windows-style workspace path '${this.partialPath}' is not supported on '${this.platform}'${cwd}.`;
  }
}

export class WorkspaceEntriesCurrentProjectRequiredError extends Schema.TaggedError<WorkspaceEntriesCurrentProjectRequiredError>()(
  "WorkspaceEntriesCurrentProjectRequiredError",
  {
    partialPath: Schema.String,
  },
) {
  override get message(): string {
    return `A current project is required to browse relative workspace path '${this.partialPath}'.`;
  }
}

export class WorkspaceEntriesReadDirectoryError extends Schema.TaggedError<WorkspaceEntriesReadDirectoryError>()(
  "WorkspaceEntriesReadDirectoryError",
  {
    cwd: Schema.optional(Schema.String),
    partialPath: Schema.String,
    parentPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get pathMissing(): boolean {
    return (this.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  }

  override get message(): string {
    const cwd = this.cwd ? ` from '${this.cwd}'` : "";
    return `Failed to read workspace directory '${this.parentPath}' while browsing '${this.partialPath}'${cwd}.`;
  }
}

export const WorkspaceEntriesBrowseError = Schema.Union([
  WorkspaceEntriesWindowsPathUnsupportedError,
  WorkspaceEntriesCurrentProjectRequiredError,
  WorkspaceEntriesReadDirectoryError,
]);
export type WorkspaceEntriesBrowseError = typeof WorkspaceEntriesBrowseError.Type;

export const WorkspaceEntriesError = Schema.Union([
  WorkspaceEntriesReadDirectoryError,
  WorkspacePaths.WorkspaceRootNotExistsError,
  WorkspacePaths.WorkspaceRootCreateFailedError,
  WorkspacePaths.WorkspaceRootStatFailedError,
  WorkspacePaths.WorkspaceRootNotDirectoryError,
  WorkspaceSearchIndex.WorkspaceSearchIndexCreateFailed,
  WorkspaceSearchIndex.WorkspaceSearchIndexScanTimedOut,
  WorkspaceSearchIndex.WorkspaceSearchIndexSearchFailed,
]);
export type WorkspaceEntriesError = typeof WorkspaceEntriesError.Type;

export class WorkspaceEntries extends Context.Service<
  WorkspaceEntries,
  {
    readonly browse: (
      input: FilesystemBrowseInput,
    ) => Effect.Effect<FilesystemBrowseResult, WorkspaceEntriesBrowseError>;
    readonly list: (
      input: ProjectListEntriesInput,
    ) => Effect.Effect<ProjectListEntriesResult, WorkspaceEntriesError>;
    readonly search: (
      input: ProjectSearchEntriesInput,
    ) => Effect.Effect<ProjectSearchEntriesResult, WorkspaceEntriesError>;
    readonly listIgnoredFiles: (
      input: ProjectListIgnoredFilesInput,
    ) => Effect.Effect<ProjectListIgnoredFilesResult, WorkspaceEntriesError>;
    readonly searchContents: (
      input: ProjectSearchContentsInput,
    ) => Effect.Effect<ProjectSearchContentsResult, WorkspaceEntriesError>;
    readonly refresh: (cwd: string) => Effect.Effect<void>;
  }
>()("t3/workspace/WorkspaceEntries") {}

/** Ignored files offered for copying; more than this is a build folder, not config. */
const IGNORED_FILES_LIMIT = 200;

/** Children classified at once when listing a folder; each symlink costs a realpath and a stat. */
const SYMLINK_RESOLVE_BATCH_SIZE = 64;

const resolveBrowseTarget = Effect.fn("WorkspaceEntries.resolveBrowseTarget")(function* (
  input: FilesystemBrowseInput,
  path: Path.Path,
): Effect.fn.Return<string, WorkspaceEntriesBrowseError> {
  const platform = yield* HostProcess.Platform;
  if (platform !== "win32" && isWindowsAbsolutePath(input.partialPath)) {
    return yield* new WorkspaceEntriesWindowsPathUnsupportedError({
      cwd: input.cwd,
      partialPath: input.partialPath,
      platform,
    });
  }

  if (!isExplicitRelativePath(input.partialPath)) {
    return path.resolve(expandHomePath(input.partialPath, yield* HostProcess.HomeDirectory));
  }

  if (!input.cwd) {
    return yield* new WorkspaceEntriesCurrentProjectRequiredError({
      partialPath: input.partialPath,
    });
  }
  return path.resolve(
    expandHomePath(input.cwd, yield* HostProcess.HomeDirectory),
    input.partialPath,
  );
});

// A link to an unresponsive network share must not hold up the local entries beside it.
const SYMLINK_TARGET_STAT_TIMEOUT = Duration.seconds(1);
// A timed-out stat cannot be cancelled and keeps a libuv worker (4 by default) busy,
// so cap target stats in flight to leave most of the pool to other fs work.
const MAX_PENDING_SYMLINK_TARGET_STATS = 2;

const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const workspaceSearchIndexes = yield* WorkspaceSearchIndex.WorkspaceSearchIndexMap;
  const policyContext =
    yield* Effect.context<Effect.Services<ReturnType<typeof WorkspaceFilePolicy.make>>>();
  const makeFilePolicy = Effect.fn("WorkspaceEntries.makeFilePolicy")((cwd: string) =>
    WorkspaceFilePolicy.make(cwd).pipe(Effect.provideContext(policyContext)),
  );
  let pendingSymlinkTargetStats = 0;
  const statSymlinkTarget = (candidate: { readonly name: string; readonly fullPath: string }) => {
    if (pendingSymlinkTargetStats >= MAX_PENDING_SYMLINK_TARGET_STATS) {
      return Promise.resolve(null);
    }
    pendingSymlinkTargetStats++;
    return NodeFSP.stat(candidate.fullPath)
      .then(
        (stats) => (stats.isDirectory() ? candidate : null),
        () => null,
      )
      .finally(() => {
        pendingSymlinkTargetStats--;
      });
  };

  const normalizeWorkspaceRoot = Effect.fn("WorkspaceEntries.normalizeWorkspaceRoot")(function* (
    cwd: string,
  ): Effect.fn.Return<string, WorkspaceEntriesError> {
    return yield* workspacePaths.normalizeWorkspaceRoot(cwd);
  });

  // Refreshing goes through `get`, which restarts the map's idle timer, so idleness is measured
  // from the last search, not the last refresh.
  const lastSearchedAt = new Map<string, number>();
  const indexIdleMillis = Duration.toMillis(WorkspaceSearchIndex.WORKSPACE_INDEX_IDLE_TTL);
  const markSearched = (indexKey: string, now: number) => {
    // A record older than the timeout counts the same as none, so it can go.
    for (const [key, searchedAt] of lastSearchedAt) {
      if (now - searchedAt >= indexIdleMillis) lastSearchedAt.delete(key);
    }
    lastSearchedAt.set(indexKey, now);
  };

  const refresh: WorkspaceEntries["Service"]["refresh"] = Effect.fn("WorkspaceEntries.refresh")(
    function* (cwd) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(cwd).pipe(
        Effect.orElseSucceed(() => cwd),
      );
      for (const variant of WorkspaceSearchIndex.WORKSPACE_SEARCH_INDEX_VARIANTS) {
        const indexKey = WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, variant);
        if (!(yield* RcMap.has(workspaceSearchIndexes.rcMap, indexKey))) {
          continue;
        }
        const searchedAt = lastSearchedAt.get(indexKey) ?? 0;
        if ((yield* Clock.currentTimeMillis) - searchedAt >= indexIdleMillis) {
          lastSearchedAt.delete(indexKey);
          yield* workspaceSearchIndexes.invalidate(indexKey);
          continue;
        }
        const recoverRefreshFailure = Effect.fn("WorkspaceEntries.recoverRefreshFailure")(
          function* (
            cause:
              | WorkspaceSearchIndex.WorkspaceSearchIndexCreateFailed
              | WorkspaceSearchIndex.WorkspaceSearchIndexRefreshFailed,
          ) {
            yield* Effect.logWarning("Failed to refresh workspace search index", {
              cwd,
              variant,
              cause,
            });
            yield* workspaceSearchIndexes.invalidate(indexKey);
          },
        );
        yield* Effect.gen(function* () {
          const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
          yield* searchIndex.refresh();
        }).pipe(
          Effect.provide(workspaceSearchIndexes.get(indexKey)),
          Effect.catchTags({
            WorkspaceSearchIndexCreateFailed: recoverRefreshFailure,
            WorkspaceSearchIndexRefreshFailed: recoverRefreshFailure,
          }),
        );
      }
    },
  );

  const browse: WorkspaceEntries["Service"]["browse"] = Effect.fn("WorkspaceEntries.browse")(
    function* (input) {
      const resolvedInputPath = yield* resolveBrowseTarget(input, path);
      const endsWithSeparator = /[\\/]$/.test(input.partialPath) || input.partialPath === "~";
      const parentPath = endsWithSeparator ? resolvedInputPath : path.dirname(resolvedInputPath);
      const prefix = endsWithSeparator ? "" : path.basename(resolvedInputPath);

      const dirents = yield* Effect.tryPromise({
        try: () => NodeFSP.readdir(parentPath, { withFileTypes: true }),
        catch: (cause) =>
          new WorkspaceEntriesReadDirectoryError({
            cwd: input.cwd,
            partialPath: input.partialPath,
            parentPath,
            cause,
          }),
      }).pipe(
        Effect.catchIf(
          (error) => {
            const code = (error.cause as NodeJS.ErrnoException | undefined)?.code;
            return code === "EACCES" || code === "EPERM";
          },
          () => Effect.succeed([]),
        ),
      );

      const showHidden = endsWithSeparator || prefix.startsWith(".");
      const lowerPrefix = prefix.toLowerCase();
      const entries: Array<{ readonly name: string; readonly fullPath: string }> = [];
      const symlinkCandidates: Array<{ readonly name: string; readonly fullPath: string }> = [];
      for (const dirent of dirents) {
        if (
          !dirent.name.toLowerCase().startsWith(lowerPrefix) ||
          (!showHidden && dirent.name.startsWith("."))
        ) {
          continue;
        }
        const fullPath = path.join(parentPath, dirent.name);
        if (dirent.isDirectory()) {
          entries.push({ name: dirent.name, fullPath });
        } else if (dirent.isSymbolicLink()) {
          symlinkCandidates.push({ name: dirent.name, fullPath });
        }
      }
      if (symlinkCandidates.length > 0) {
        const resolvedSymlinks = yield* Effect.forEach(
          symlinkCandidates,
          (candidate) =>
            Effect.promise(() => statSymlinkTarget(candidate)).pipe(
              Effect.timeoutOption(SYMLINK_TARGET_STAT_TIMEOUT),
              Effect.map(Option.getOrNull),
            ),
          { concurrency: MAX_PENDING_SYMLINK_TARGET_STATS },
        );
        for (const candidate of resolvedSymlinks) {
          if (candidate !== null) entries.push(candidate);
        }
      }

      return {
        parentPath,
        entries: entries.toSorted((left, right) => left.name.localeCompare(right.name)),
      };
    },
  );

  const search: WorkspaceEntries["Service"]["search"] = Effect.fn("WorkspaceEntries.search")(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      const normalizedQuery = normalizeSearchQuery(input.query, {
        trimLeadingPattern: /^[@./]+/,
      });
      const indexKey = WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, "paths");
      markSearched(indexKey, yield* Clock.currentTimeMillis);
      return yield* Effect.gen(function* () {
        const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
        return yield* searchIndex.search(normalizedQuery, input.limit, input.kind, input.imageOnly);
      }).pipe(Effect.provide(workspaceSearchIndexes.get(indexKey)));
    },
  );

  const searchContents: WorkspaceEntries["Service"]["searchContents"] = Effect.fn(
    "WorkspaceEntries.searchContents",
  )(function* (input) {
    const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
    const indexKey = WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, "content");
    markSearched(indexKey, yield* Clock.currentTimeMillis);
    return yield* Effect.gen(function* () {
      const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
      return yield* searchIndex.searchContents(input);
    }).pipe(Effect.provide(workspaceSearchIndexes.get(indexKey)));
  });

  const list: WorkspaceEntries["Service"]["list"] = Effect.fn("WorkspaceEntries.list")(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      if (input.directoryPath !== undefined) {
        const directoryPath = input.directoryPath;
        const toError = (cause: unknown) =>
          new WorkspaceEntriesReadDirectoryError({
            cwd: normalizedCwd,
            partialPath: directoryPath,
            parentPath: path.resolve(normalizedCwd, directoryPath),
            cause,
          });
        const target =
          directoryPath === ""
            ? { absolutePath: normalizedCwd, relativePath: "" }
            : yield* workspacePaths
                .resolveRelativePathWithinRoot({
                  workspaceRoot: normalizedCwd,
                  relativePath: directoryPath,
                })
                .pipe(Effect.mapError(toError));
        const { entries, throughSymlink, symlinkPaths } = yield* Effect.tryPromise({
          try: async () => {
            const root = await NodeFSP.realpath(normalizedCwd);
            const directory = await NodeFSP.realpath(target.absolutePath);
            const relative = path.relative(root, directory);
            if (
              relative === ".." ||
              relative.startsWith(`..${path.sep}`) ||
              path.isAbsolute(relative) ||
              relative.split(path.sep).includes(".git") ||
              target.relativePath.split("/").includes(".git")
            ) {
              throw new Error("Directory must be inside the workspace and outside .git.");
            }
            const children = await NodeFSP.readdir(directory, { withFileTypes: true });
            const isSameOrInside = (parent: string, child: string) => {
              const relativeChild = path.relative(parent, child);
              return (
                relativeChild !== ".." &&
                !relativeChild.startsWith(`..${path.sep}`) &&
                !path.isAbsolute(relativeChild)
              );
            };
            // Reject canonical ancestors so "Expand all folders" cannot follow a cycle.
            let visitedFolders: Promise<ReadonlyArray<string>> | undefined;
            const loadVisitedFolders = () =>
              (visitedFolders ??= (async () => {
                const folders = [root];
                let current = normalizedCwd;
                for (const segment of target.relativePath.split("/").filter(Boolean)) {
                  current = path.join(current, segment);
                  folders.push(await NodeFSP.realpath(current));
                }
                return folders;
              })());
            const resolveSymlinkKind = async (
              name: string,
            ): Promise<ProjectEntry["kind"] | undefined> => {
              const resolved = await NodeFSP.realpath(path.join(directory, name)).catch(
                () => undefined,
              );
              if (
                resolved === undefined ||
                !isSameOrInside(root, resolved) ||
                path.relative(root, resolved).split(path.sep).includes(".git")
              ) {
                return undefined;
              }
              const stat = await NodeFSP.stat(resolved).catch(() => undefined);
              if (stat?.isFile()) return "file";
              if (!stat?.isDirectory()) return undefined;
              const folders = await loadVisitedFolders();
              return folders.some((folder) => isSameOrInside(resolved, folder))
                ? undefined
                : "directory";
            };
            // Bound filesystem work for directories such as pnpm node_modules.
            const kinds: Array<ProjectEntry["kind"] | undefined> = [];
            for (let offset = 0; offset < children.length; offset += SYMLINK_RESOLVE_BATCH_SIZE) {
              kinds.push(
                ...(await Promise.all(
                  children
                    .slice(offset, offset + SYMLINK_RESOLVE_BATCH_SIZE)
                    .map(async (child): Promise<ProjectEntry["kind"] | undefined> => {
                      if (child.name === ".git") return undefined;
                      if (child.isDirectory()) return "directory";
                      if (child.isFile()) return "file";
                      return child.isSymbolicLink() ? resolveSymlinkKind(child.name) : undefined;
                    }),
                )),
              );
            }
            return {
              symlinkPaths: new Set(
                children
                  .filter((child) => child.isSymbolicLink())
                  .map((child) =>
                    target.relativePath ? `${target.relativePath}/${child.name}` : child.name,
                  ),
              ),
              entries: children.flatMap((child, index): ProjectEntry[] => {
                const kind = kinds[index];
                if (kind === undefined) return [];
                return [
                  {
                    path: target.relativePath ? `${target.relativePath}/${child.name}` : child.name,
                    kind,
                  },
                ];
              }),
              // Alias children retain their own browse path, not the target's ignore context.
              throughSymlink: relative !== target.relativePath.split("/").join(path.sep),
            };
          },
          catch: toError,
        });
        if (throughSymlink) return { entries, truncated: false };
        const policy = yield* makeFilePolicy(normalizedCwd).pipe(Effect.mapError(toError));
        const ignored = yield* policy
          .ignored(
            entries.map((entry) => ({ ...entry, symlink: symlinkPaths.has(entry.path) })),
            "browse",
          )
          .pipe(Effect.mapError(toError));
        return {
          entries: entries.map((entry) =>
            ignored.has(entry.path) ? { ...entry, ignored: true } : entry,
          ),
          truncated: false,
        };
      }
      const indexKey = WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, "paths");
      markSearched(indexKey, yield* Clock.currentTimeMillis);
      return yield* Effect.gen(function* () {
        const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
        return yield* searchIndex.list();
      }).pipe(Effect.provide(workspaceSearchIndexes.get(indexKey)));
    },
  );

  const listIgnoredFiles: WorkspaceEntries["Service"]["listIgnoredFiles"] = Effect.fn(
    "WorkspaceEntries.listIgnoredFiles",
  )(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      const toError = (cause: unknown) =>
        new WorkspaceEntriesReadDirectoryError({
          cwd: normalizedCwd,
          partialPath: "",
          parentPath: normalizedCwd,
          cause,
        });
      const policy = yield* makeFilePolicy(normalizedCwd).pipe(Effect.mapError(toError));
      const root = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(normalizedCwd),
        catch: toError,
      });
      const query = input.query?.toLowerCase() ?? "";
      const pending: Array<{ path: string; kind: "file" | "directory"; ignored: boolean }> = [
        { path: "", kind: "directory", ignored: false },
      ];
      const files: Array<{ path: string; byteLength: number }> = [];
      while (pending.length > 0 && files.length <= IGNORED_FILES_LIMIT) {
        const entry = pending.pop()!;
        if (entry.kind === "file") {
          if (!entry.ignored || !entry.path.toLowerCase().includes(query)) continue;
          const stat = yield* Effect.tryPromise({
            try: () => NodeFSP.lstat(path.join(normalizedCwd, entry.path)),
            catch: toError,
          }).pipe(
            Effect.catchIf(
              (error) => (error.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT",
              () => Effect.succeed(null),
            ),
          );
          if (stat?.isFile()) files.push({ path: entry.path, byteLength: stat.size });
          continue;
        }
        // Excluded folders are bulk output, not individual configuration files offered for copying.
        if (entry.ignored) continue;
        const directory = yield* Effect.tryPromise({
          try: async () => {
            const candidate = path.join(root, entry.path);
            if (!(await NodeFSP.lstat(candidate)).isDirectory()) return undefined;
            const canonical = await NodeFSP.realpath(candidate);
            const relative = path.relative(root, canonical);
            if (
              relative === ".." ||
              relative.startsWith(`..${path.sep}`) ||
              path.isAbsolute(relative) ||
              relative.split(path.sep).includes(".git")
            )
              return undefined;
            return canonical;
          },
          catch: toError,
        });
        if (directory === undefined) continue;
        const children = yield* Effect.tryPromise({
          try: () => NodeFSP.readdir(directory, { withFileTypes: true }),
          catch: toError,
        });
        const candidates = children.flatMap((child) =>
          child.name !== ".git" && (child.isFile() || child.isDirectory())
            ? [
                {
                  path: entry.path ? `${entry.path}/${child.name}` : child.name,
                  kind: child.isDirectory() ? ("directory" as const) : ("file" as const),
                },
              ]
            : [],
        );
        const ignored = yield* policy.ignored(candidates, "browse").pipe(Effect.mapError(toError));
        candidates.sort((left, right) => {
          const a = left.path + (left.kind === "directory" ? "/" : "");
          const b = right.path + (right.kind === "directory" ? "/" : "");
          return a < b ? -1 : a > b ? 1 : 0;
        });
        for (let index = candidates.length - 1; index >= 0; index--) {
          const child = candidates[index]!;
          pending.push({ ...child, ignored: ignored.has(child.path) });
        }
      }
      return {
        files: files.slice(0, IGNORED_FILES_LIMIT),
        truncated: files.length > IGNORED_FILES_LIMIT,
      };
    },
    (effect, input) =>
      effect.pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () =>
            Effect.fail(
              new WorkspaceEntriesReadDirectoryError({
                cwd: input.cwd,
                partialPath: "",
                parentPath: input.cwd,
                cause: new Error("Ignored-file listing exceeded its deadline."),
              }),
            ),
        }),
      ),
  );

  return WorkspaceEntries.of({ browse, list, listIgnoredFiles, refresh, search, searchContents });
});

export const layer = Layer.effect(WorkspaceEntries, make).pipe(
  Layer.provide(WorkspaceSearchIndex.WorkspaceSearchIndexMap.layer),
);
