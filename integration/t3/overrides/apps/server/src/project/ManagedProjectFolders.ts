import { CommandId, GitUnavailableError, ProjectId, type ThreadId } from "@t3tools/contracts";
import { foldLatinDiacritics } from "@t3tools/shared/path";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ProjectService from "./ProjectService.ts";

export class ScratchUnavailableError extends Schema.TaggedError<ScratchUnavailableError>()(
  "ScratchUnavailableError",
  {
    baseDir: Schema.String,
  },
) {
  override get message(): string {
    return "Threads without a project are not available on this environment.";
  }
}

export class ScratchFolderError extends Schema.TaggedError<ScratchFolderError>()(
  "ScratchFolderError",
  {
    folder: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to create the folder for threads without a project.";
  }
}

export class ScratchProjectError extends Schema.TaggedError<ScratchProjectError>()(
  "ScratchProjectError",
  {
    workspaceRoot: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to create the project for threads without a project.";
  }
}

/** Where No project threads keep their folders, whether or not this T3 home allows them. */
export const scratchFolderRoot = (baseDir: string, path: Path.Path) =>
  path.resolve(baseDir, "scratch");

export type ScratchError = ScratchUnavailableError | ScratchFolderError | ScratchProjectError;

export class NamedProjectFolderError extends Schema.TaggedError<NamedProjectFolderError>()(
  "NamedProjectFolderError",
  {
    folder: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to create the project folder.";
  }
}

export class NamedProjectCreateError extends Schema.TaggedError<NamedProjectCreateError>()(
  "NamedProjectCreateError",
  {
    workspaceRoot: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to create the project.";
  }
}

export type NamedProjectError =
  | NamedProjectFolderError
  | NamedProjectCreateError
  | GitUnavailableError;

export class ManagedProjectFolders extends Context.Service<
  ManagedProjectFolders,
  {
    readonly scratchRoot: Effect.Effect<Option.Option<string>>;
    readonly ensureScratchProject: Effect.Effect<{ readonly projectId: ProjectId }, ScratchError>;
    readonly isScratchProject: (projectId: ProjectId) => Effect.Effect<boolean>;
    readonly folderForThread: (input: {
      readonly projectId: ProjectId;
      readonly threadId: ThreadId;
      readonly text: string;
    }) => Effect.Effect<Option.Option<string>, ScratchFolderError>;
    readonly namedProjectsRoot: string;
    /** Removes failed/cancelled creations' folders only while no project owns them. */
    readonly createNamedProject: (input: { readonly name: string }) => Effect.Effect<
      {
        readonly projectId: ProjectId;
        readonly workspaceRoot: string;
        readonly commitError?: string;
      },
      NamedProjectError
    >;
  }
>()("t3/project/ManagedProjectFolders") {}

const folderWords = (text: string) =>
  foldLatinDiacritics(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 5)
    .join("-")
    .slice(0, 48)
    .replace(/-+$/, "");

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService.ProjectService;
  const random = yield* SecureRandom.SecureRandom;

  // Non-recursive mkdir atomically claims a name; racers move on after AlreadyExists.
  const claimFreeFolder = Effect.fnUntraced(function* <E>(
    folderFor: (attempt: number) => Effect.Effect<Option.Option<string>, E>,
    onError: (folder: string, cause: PlatformError.PlatformError) => E,
  ) {
    for (let attempt = 1; ; attempt++) {
      const folder = yield* folderFor(attempt);
      if (Option.isNone(folder)) return folder;
      const claimed = yield* fileSystem.makeDirectory(folder.value).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => error.reason._tag === "AlreadyExists",
          () => Effect.succeed(false),
        ),
        Effect.mapError((cause) => onError(folder.value, cause)),
      );
      if (claimed) return folder;
    }
  });

  const root = scratchFolderRoot(config.baseDir, path);
  // A symlinked scratch folder lets the No project live at either the link or its target.
  const scratchProjectRoot = (root: string) =>
    fileSystem.realPath(root).pipe(
      Effect.flatMap((target) =>
        target === root
          ? Effect.succeed(root)
          : projects
              .getByWorkspaceRoot(target)
              .pipe(Effect.map((project) => (Option.isSome(project) ? target : root))),
      ),
      Effect.orElseSucceed(() => root),
    );
  const scratchRoot = scratchProjectRoot(root).pipe(Effect.asSome);

  const makeScratchFolder = (folder: string) =>
    fileSystem
      .makeDirectory(folder, { recursive: true })
      .pipe(Effect.mapError((cause) => new ScratchFolderError({ folder, cause })));

  const ensureScratchProject: ManagedProjectFolders["Service"]["ensureScratchProject"] = Effect.gen(
    function* () {
      yield* makeScratchFolder(root);
      const workspaceRoot = yield* scratchProjectRoot(root);
      const id = yield* random
        .uuidV4()
        .pipe(Effect.mapError((cause) => new ScratchProjectError({ workspaceRoot, cause })));
      const bootstrapped = yield* projects
        .bootstrap({
          commandId: CommandId.make(`scratch-project:${id}`),
          projectId: ProjectId.make(id),
          title: "No project",
          workspaceRoot,
        })
        .pipe(
          // bootstrap reads before locking; racing creates return the winner in a conflict.
          Effect.catchTags({
            ProjectConflictError: (conflict) =>
              Effect.succeed({
                project: { id: conflict.conflictingProjectId },
                created: false,
              }),
          }),
          Effect.mapError((cause) => new ScratchProjectError({ workspaceRoot, cause })),
        );
      if (bootstrapped.created) {
        // Set once at create, so a user's own icon choice is never overwritten.
        yield* projects
          .update({
            commandId: CommandId.make(`scratch-project-icon:${id}`),
            projectId: bootstrapped.project.id,
            projectIcon: { kind: "lucide", name: "message-square-dashed", color: "gray" },
          })
          .pipe(Effect.mapError((cause) => new ScratchProjectError({ workspaceRoot, cause })));
      }
      return { projectId: bootstrapped.project.id };
    },
  );

  const isScratchRoot = (projectId: ProjectId, root: string) =>
    projects.getById(projectId).pipe(
      Effect.map(
        Option.exists((project) => path.resolve(project.workspaceRoot) === path.resolve(root)),
      ),
      Effect.orElseSucceed(() => false),
    );

  const isScratchProject: ManagedProjectFolders["Service"]["isScratchProject"] = (projectId) =>
    scratchRoot.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(false),
          onSome: (root) => isScratchRoot(projectId, root),
        }),
      ),
    );

  const folderForThread: ManagedProjectFolders["Service"]["folderForThread"] = Effect.fn(
    "ManagedProjectFolders.folderForThread",
  )(function* (input) {
    const root = yield* scratchRoot;
    if (Option.isNone(root)) return Option.none();
    if (!(yield* isScratchRoot(input.projectId, root.value))) return Option.none();
    const date = DateTime.formatIso(yield* DateTime.now).slice(0, 10);
    const words = folderWords(input.text);
    const id = input.threadId.toLowerCase().replace(/[^a-z0-9]/g, "");
    const folderFor = (idPart: string) =>
      path.join(root.value, [date, words, idPart].filter(Boolean).join("-"));
    yield* makeScratchFolder(root.value);
    const fullFolder = folderFor(id);
    return yield* claimFreeFolder(
      (attempt) =>
        attempt === 1
          ? Effect.succeedSome(folderFor(id.slice(-8)))
          : attempt === 2
            ? Effect.succeedSome(fullFolder)
            : random.uuidV4().pipe(
                Effect.map((uuid) => Option.some(`${fullFolder}-${uuid.slice(0, 8)}`)),
                Effect.mapError((cause) => new ScratchFolderError({ folder: fullFolder, cause })),
              ),
      (folder, cause) => new ScratchFolderError({ folder, cause }),
    );
  });

  const namedProjectsRoot = path.resolve(config.baseDir, "projects");

  const createNamedProject: ManagedProjectFolders["Service"]["createNamedProject"] = Effect.fn(
    "ManagedProjectFolders.createNamedProject",
  )(function* () {
    return yield* new GitUnavailableError({ reason: "feature-disabled" });
  });

  return ManagedProjectFolders.of({
    scratchRoot,
    ensureScratchProject,
    isScratchProject,
    folderForThread,
    namedProjectsRoot,
    createNamedProject,
  });
});

export const layer = Layer.effect(ManagedProjectFolders, make);
