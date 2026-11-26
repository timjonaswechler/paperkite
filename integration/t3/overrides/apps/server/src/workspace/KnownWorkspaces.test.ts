import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";

it.effect("authorizes registered folders and rejects paths that resolve outside them", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const temp = yield* fs.makeTempDirectoryScoped();
    const workspaceRoot = path.join(temp, "project");
    const tracked = path.join(temp, "tracked");
    const unrelated = path.join(temp, "project-other");
    const inside = path.join(workspaceRoot, "notes");
    const escape = path.join(workspaceRoot, "escape");
    for (const folder of [inside, tracked, unrelated]) {
      yield* fs.makeDirectory(folder, { recursive: true });
    }
    yield* fs.symlink(unrelated, escape);
    const projectStore = Layer.mock(ProjectStore.ProjectStoreV2)({
      listShells: () =>
        Effect.succeed([
          {
            id: ProjectId.make("project:test"),
            title: "Project",
            workspaceRoot,
            defaultModelSelection: null,
            scripts: [],
            trackedFolders: [
              { path: tracked, name: "Tracked" },
              { path: escape, name: "Previously discovered", discovered: true },
            ],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
    });

    yield* Effect.gen(function* () {
      const known = yield* KnownWorkspaces.KnownWorkspaces;
      yield* known.assertContains(inside);
      yield* known.assertContains(tracked);
      for (const cwd of [unrelated, escape]) {
        const error = yield* Effect.flip(known.assertContains(cwd));
        expect(error).toBeInstanceOf(KnownWorkspaces.UnknownWorkspaceError);
      }
    }).pipe(Effect.provide(KnownWorkspaces.layer.pipe(Layer.provide(projectStore))));
  }).pipe(Effect.provide(NodeServices.layer)),
);
