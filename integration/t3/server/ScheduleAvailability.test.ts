import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, type ScheduledTaskUpsertInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ThreadLaunch from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as ManagedPolicy from "../../policy/ManagedPolicy.ts";
import * as ManagedFolders from "../../project/ManagedProjectFolders.ts";
import * as ScheduledTasks from "../../scheduledTasks/ScheduledTaskService.ts";
import * as Scheduler from "../../scheduling/Scheduler.ts";
import * as SecretRequests from "../../secrets/SecretRequests.ts";
import * as Runtime from "./Runtime.ts";

const layerTest = ScheduledTasks.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      ManagedPolicy.layerTest(),
      Layer.mock(ThreadLaunch.ThreadLaunchService)({}),
      Layer.mock(ThreadManagement.ThreadManagementService)({}),
      Layer.mock(ManagedFolders.ManagedProjectFolders)({ namedProjectsRoot: "/fixture/projects" }),
      Layer.mock(SecretRequests.SecretRequests)({}),
    ),
  ),
  Layer.provide(Sqlite.layerMemory),
  Layer.provide(Layer.succeed(Runtime.Profile, Runtime.status("proof"))),
);

it.effect(
  "rejects Git schedules before saving or probing a workspace and retains folder-only schedules",
  () =>
    Effect.gen(function* () {
      const service = yield* ScheduledTasks.ScheduledTaskService;
      const input: ScheduledTaskUpsertInput = {
        title: "Fixture schedule",
        prompt: "No provider is started",
        enabled: false,
        projectId: ProjectId.make("fixture"),
        schedule: { type: "interval", everyMs: 60_000 },
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: ProviderInstanceId.make("fixture"), model: "fixture" },
        runtimeMode: "full-access",
        interactionMode: "default",
      };
      for (const workspaceStrategy of [
        { type: "worktree", baseRef: "main" },
        { type: "existing_worktree", worktreePath: "/fixture/worktree" },
        { type: "root", branch: "feature" },
      ] as const) {
        expect(
          yield* service.upsert({ ...input, workspaceStrategy }).pipe(Effect.flip),
        ).toMatchObject({
          _tag: "ScheduledTaskError",
          message: "Git workspaces are unavailable in this Paperkite profile.",
        });
      }
      expect((yield* service.list()).tasks).toEqual([]);
      const saved = yield* service.upsert(input);
      expect((yield* service.list()).tasks.map((task) => task.id)).toEqual([saved.task.id]);
      expect(saved.task.workspaceStrategy).toEqual({ type: "root" });
    }).pipe(Effect.provide(layerTest)),
);
