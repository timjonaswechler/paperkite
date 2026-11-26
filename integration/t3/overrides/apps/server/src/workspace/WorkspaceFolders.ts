import {
  PROJECT_TRACKED_FOLDERS_MAX,
  type ProjectId,
  type ProjectTrackedFolder,
  type WorkspaceFolder,
  WorkspaceFoldersError,
  type WorkspaceListFoldersInput,
  type WorkspaceListFoldersResult,
  type WorkspaceScanFoldersInput,
  type WorkspaceScanFoldersResult,
} from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { isWithinRoot } from "./KnownWorkspaces.ts";

/** A tracked folder a thread works in, besides its own cwd. */
export interface ThreadFolder {
  readonly name: string;
  readonly path: string;
  readonly isGitRepository: boolean;
  /** The folder `path` is a checkout of. Absent when `path` is that folder. */
  readonly repositoryPath?: string;
}

export interface ThreadWorkspace {
  readonly folders: ReadonlyArray<ThreadFolder>;
  /** Paths of the folders outside the thread's cwd, which an agent needs granted to reach. */
  readonly extraRoots: ReadonlyArray<string>;
}

const EMPTY_WORKSPACE: ThreadWorkspace = { folders: [], extraRoots: [] };

export class WorkspaceFolders extends Context.Service<
  WorkspaceFolders,
  {
    /** The existing tracked folders and their sandbox roots for a project thread. */
    readonly forThread: (input: {
      readonly projectId: ProjectId;
      readonly worktreePath: string | null;
    }) => Effect.Effect<ThreadWorkspace, WorkspaceFoldersError>;
    readonly list: (
      input: WorkspaceListFoldersInput,
    ) => Effect.Effect<WorkspaceListFoldersResult, WorkspaceFoldersError>;
    readonly scan: (
      input: WorkspaceScanFoldersInput,
    ) => Effect.Effect<WorkspaceScanFoldersResult, WorkspaceFoldersError>;
  }
>()("t3/workspace/WorkspaceFolders") {}

const DETECTION_CONCURRENCY = 8;
// What `ProjectTrackedFolder.name` allows.
const FOLDER_NAME_MAX = 128;
const boundedName = (name: string) => name.slice(0, FOLDER_NAME_MAX).trim();
const CODE_WORKSPACE_EXTENSION = ".code-workspace";

const decodeCodeWorkspace = Schema.decodeUnknownEffect(
  fromLenientJson(
    Schema.Struct({
      folders: Schema.optional(
        Schema.Array(
          Schema.Struct({
            path: Schema.optional(Schema.String),
            name: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  ),
);

/** Used by the uncomposed upstream TaskFolders implementation. */
export const parseGitmodulesPaths = (text: string): ReadonlyArray<string> =>
  text.split(/\r?\n/).flatMap((line) => {
    const value = /^\s*path\s*=\s*(.*?)\s*$/.exec(line)?.[1];
    if (value === undefined) return [];
    const normalized = value.replaceAll('"', "").replaceAll("\\", "/").replace(/\/+$/, "");
    return normalized === "" ? [] : [normalized];
  });

const readCodeWorkspaceFolders = Effect.fn("WorkspaceFolders.readCodeWorkspaceFolders")(function* (
  root: string,
  fileName: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const document = yield* fileSystem
    .readFileString(path.join(root, fileName))
    .pipe(Effect.flatMap(decodeCodeWorkspace), Effect.option);
  if (Option.isNone(document)) return null;
  return (document.value.folders ?? []).flatMap((folder) => {
    const folderPath = folder.path?.trim();
    if (folderPath === undefined || folderPath === "") return [];
    const resolved = path.resolve(root, folderPath);
    return [
      {
        path: resolved,
        name: boundedName(folder.name?.trim() ?? "") || boundedName(path.basename(resolved)),
      },
    ];
  });
});

const scanFolders = Effect.fn("WorkspaceFolders.scan")(function* (
  input: WorkspaceScanFoldersInput,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(
    expandHomePath(input.workspaceRoot.trim(), yield* HostProcess.HomeDirectory),
  );
  const names = (yield* fileSystem
    .readDirectory(root)
    .pipe(
      Effect.mapError(
        () => new WorkspaceFoldersError({ operation: "scan", detail: `Could not read ${root}.` }),
      ),
    )).toSorted();
  const codeWorkspaceFile = names.find((name) => name.endsWith(CODE_WORKSPACE_EXTENSION));
  const listed =
    codeWorkspaceFile === undefined
      ? null
      : yield* readCodeWorkspaceFolders(root, codeWorkspaceFile);
  const realRoot = yield* fileSystem.realPath(root).pipe(Effect.orElseSucceed(() => root));
  const existing = yield* Effect.forEach(
    listed ?? [],
    (folder) =>
      Effect.all([fileSystem.realPath(folder.path), fileSystem.stat(folder.path)]).pipe(
        Effect.map(([real, info]) => (info.type === "Directory" ? { folder, real } : undefined)),
        Effect.orElseSucceed(() => undefined),
      ),
    { concurrency: DETECTION_CONCURRENCY },
  );
  const seen = new Set<string>();
  const folders: WorkspaceScanFoldersResult["folders"][number][] = [];
  for (const item of existing) {
    // The scanned folder and its parents cannot be tracked, even through a symlink.
    if (item === undefined || seen.has(item.real) || isWithinRoot(path, realRoot, item.real)) {
      continue;
    }
    seen.add(item.real);
    folders.push({ ...item.folder, isGitRepository: false, source: "code-workspace" });
    if (folders.length === PROJECT_TRACKED_FOLDERS_MAX) break;
  }
  return {
    workspaceRoot: root,
    isGitRepository: false,
    codeWorkspaceFile:
      listed === null || codeWorkspaceFile === undefined
        ? null
        : path.join(root, codeWorkspaceFile),
    folders,
  } satisfies WorkspaceScanFoldersResult;
});

/** Used by the uncomposed upstream TaskFolders implementation. */
export const projectFolders = Effect.fn("WorkspaceFolders.projectFolders")(
  (project: { readonly trackedFolders: ReadonlyArray<ProjectTrackedFolder> }) =>
    Effect.succeed(project.trackedFolders),
);

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const realPath = (target: string) =>
    fileSystem.realPath(target).pipe(Effect.orElseSucceed(() => target));

  const classify = Effect.fnUntraced(function* (
    folder: ProjectTrackedFolder,
  ): Effect.fn.Return<WorkspaceFolder> {
    const isDirectory = yield* fileSystem.stat(folder.path).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
    return { ...folder, state: isDirectory ? "plain" : "missing" };
  });

  const readProject = Effect.fn("WorkspaceFolders.readProject")(function* (projectId: ProjectId) {
    const row = yield* projects
      .get(projectId)
      .pipe(
        Effect.mapError(
          () => new WorkspaceFoldersError({ operation: "list", detail: "Failed to read project." }),
        ),
      );
    if (Option.isNone(row)) {
      return yield* new WorkspaceFoldersError({
        operation: "list",
        detail: `Project ${projectId} was not found.`,
      });
    }
    return row.value;
  });

  const classifyAll = (folders: ReadonlyArray<ProjectTrackedFolder>) =>
    Effect.forEach(folders, classify, { concurrency: DETECTION_CONCURRENCY });
  const forThread: WorkspaceFolders["Service"]["forThread"] = Effect.fn(
    "WorkspaceFolders.forThread",
  )(function* (input) {
    if (input.worktreePath !== null) return EMPTY_WORKSPACE;
    const project = yield* readProject(input.projectId);
    const tracked = project.trackedFolders;
    if (tracked.length === 0) return EMPTY_WORKSPACE;
    const projectRoot = yield* realPath(project.workspaceRoot);
    const accessible = yield* Effect.forEach(
      yield* classifyAll(tracked),
      Effect.fnUntraced(function* (folder) {
        if (folder.state === "missing") return [];
        const real = yield* realPath(folder.path);
        const inside = isWithinRoot(path, real, projectRoot);
        // Previously discovered folders were automatically admitted inside the project only.
        if (!inside && folder.discovered === true) return [];
        return [{ folder, real, inside }];
      }),
      { concurrency: DETECTION_CONCURRENCY },
    );
    const folders: ThreadFolder[] = [];
    const extraRoots = new Set<string>();
    for (const { folder, real, inside } of accessible.flat()) {
      folders.push({ name: folder.name, path: folder.path, isGitRepository: false });
      // Agents see the stored path while sandboxes use its real path.
      if (!inside) {
        extraRoots.add(folder.path);
        extraRoots.add(real);
      }
    }
    return { folders, extraRoots: [...extraRoots] };
  });

  const list: WorkspaceFolders["Service"]["list"] = Effect.fn("WorkspaceFolders.list")(
    function* (input) {
      const project = yield* readProject(input.projectId);
      return { folders: yield* classifyAll(project.trackedFolders) };
    },
  );

  const scan: WorkspaceFolders["Service"]["scan"] = (input) =>
    scanFolders(input).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  return WorkspaceFolders.of({ forThread, list, scan });
});

export const layer = Layer.effect(WorkspaceFolders, make);
