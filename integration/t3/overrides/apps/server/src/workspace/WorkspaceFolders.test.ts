import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, type ProjectTrackedFolder } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as WorkspaceFolders from "./WorkspaceFolders.ts";

const projectId = ProjectId.make("project:workspace-folders");

const layerFor = (project?: {
  readonly workspaceRoot: string;
  readonly trackedFolders: ReadonlyArray<ProjectTrackedFolder>;
}) =>
  WorkspaceFolders.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () =>
          project === undefined
            ? Effect.succeedNone
            : Effect.succeedSome({
                projectId,
                title: "Project",
                hasCustomTitle: false,
                defaultModelSelection: null,
                defaultThreadEnvMode: null,
                autoPull: false,
                faviconPath: null,
                projectIcon: null,
                scripts: [],
                pinnedAt: null,
                archivedAt: null,
                createdAt: "2026-06-21T00:00:00.000Z",
                updatedAt: "2026-06-21T00:00:00.000Z",
                deletedAt: null,
                ...project,
              }),
      }),
    ),
  );

// Resolved, so a symlinked temp directory does not show up as a second spelling of each path.
const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-workspace-folders-" }),
  );
});

it.layer(NodeServices.layer)("WorkspaceFolders", (it) => {
  it.effect("offers existing folders explicitly listed in a code-workspace file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const temp = yield* makeTempDir;
      const root = path.join(temp, "workspace");
      const outside = path.join(temp, "outside");
      for (const folder of [
        path.join(root, "notes"),
        path.join(root, "unlisted", ".git"),
        outside,
      ]) {
        yield* fs.makeDirectory(folder, { recursive: true });
      }
      yield* fs.symlink(outside, path.join(root, "duplicate"));
      yield* fs.symlink(root, path.join(root, "self"));
      yield* fs.writeFileString(path.join(root, "regular-file"), "text");
      const codeWorkspaceFile = path.join(root, "team.code-workspace");
      yield* fs.writeFileString(
        codeWorkspaceFile,
        `{
          // Missing entries leave room for the folders that exist.
          "folders": [
            ${Array.from({ length: 130 }, (_, i) => `{ "path": "missing-${i}" },`).join("")}
            { "path": "notes", "name": "Notes" },
            { "path": "../outside" },
            { "path": "duplicate" },
            { "path": "regular-file" },
            { "path": "self" },
            { "path": ".." },
          ],
        }`,
      );

      const observed: string[] = [];
      const record = (target: string) => observed.push(target);
      const observedFileSystem = FileSystem.FileSystem.of({
        ...fs,
        exists: (target) => {
          record(target);
          return fs.exists(target);
        },
        stat: (target) => {
          record(target);
          return fs.stat(target);
        },
        readFileString: (target, encoding) => {
          record(target);
          return fs.readFileString(target, encoding);
        },
      });
      yield* Effect.gen(function* () {
        const workspaceFolders = yield* WorkspaceFolders.WorkspaceFolders;
        assert.deepEqual(yield* workspaceFolders.scan({ workspaceRoot: root }), {
          workspaceRoot: root,
          isGitRepository: false,
          codeWorkspaceFile,
          folders: [
            {
              path: path.join(root, "notes"),
              name: "Notes",
              isGitRepository: false,
              source: "code-workspace",
            },
            { path: outside, name: "outside", isGitRepository: false, source: "code-workspace" },
          ],
        });
        assert.equal(
          (yield* Effect.flip(workspaceFolders.scan({ workspaceRoot: path.join(root, "missing") })))
            ._tag,
          "WorkspaceFoldersError",
        );
        assert.deepEqual(
          observed.filter((target) => [".git", ".gitmodules"].includes(path.basename(target))),
          [],
        );
      }).pipe(
        Effect.provide(layerFor()),
        Effect.provideService(FileSystem.FileSystem, observedFileSystem),
      );
    }),
  );

  it.effect("keeps stored folders and grants a project thread their external roots", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const temp = yield* makeTempDir;
      const workspaceRoot = path.join(temp, "app");
      const inside = { name: "Web", path: path.join(workspaceRoot, "web"), discovered: true };
      const outside = { name: "Shared", path: path.join(temp, "shared") };
      const missing = { name: "Missing", path: path.join(temp, "missing") };
      const linked = { name: "Link", path: path.join(workspaceRoot, "link") };
      const discoveredLink = {
        name: "Previously discovered",
        path: path.join(workspaceRoot, "discovered-link"),
        discovered: true,
      };
      const unrelated = path.join(temp, "unrelated");
      for (const folder of [inside.path, outside.path, unrelated]) {
        yield* fs.makeDirectory(folder, { recursive: true });
      }
      yield* fs.symlink(outside.path, linked.path);
      yield* fs.symlink(unrelated, discoveredLink.path);

      yield* Effect.gen(function* () {
        const workspaceFolders = yield* WorkspaceFolders.WorkspaceFolders;
        assert.deepEqual(yield* workspaceFolders.list({ projectId }), {
          folders: [
            { ...inside, state: "plain" },
            { ...outside, state: "plain" },
            { ...missing, state: "missing" },
            { ...linked, state: "plain" },
            { ...discoveredLink, state: "plain" },
          ],
        });
        assert.deepEqual(yield* workspaceFolders.forThread({ projectId, worktreePath: null }), {
          folders: [
            { name: inside.name, path: inside.path, isGitRepository: false },
            { ...outside, isGitRepository: false },
            { ...linked, isGitRepository: false },
          ],
          extraRoots: [outside.path, linked.path],
        });
        assert.deepEqual(
          yield* workspaceFolders.forThread({ projectId, worktreePath: path.join(temp, "old") }),
          { folders: [], extraRoots: [] },
        );
      }).pipe(
        Effect.provide(
          layerFor({
            workspaceRoot,
            trackedFolders: [inside, outside, missing, linked, discoveredLink],
          }),
        ),
      );
    }),
  );
});
