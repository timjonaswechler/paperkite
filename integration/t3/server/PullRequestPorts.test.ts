import { expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Native from "../../pullRequest/PullRequestService.ts";
import * as IssueService from "../../issue/IssueService.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as WorkflowForge from "../../workflows/WorkflowForge.ts";
import * as Port from "./NativePullRequests.ts";

it.effect(
  "the lightweight optional port sees native test providers without importing them in the product",
  () =>
    Effect.gen(function* () {
      expect(Option.isNone(yield* Effect.serviceOption(Port.PullRequestService))).toBe(true);
      const reads = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const service = yield* Port.PullRequestService;
        yield* service.refreshAfterTurn(ProjectId.make("fixture"));
      }).pipe(
        Effect.provide(
          Layer.mock(Native.PullRequestService)({
            refreshAfterTurn: () => Ref.update(reads, (count) => count + 1),
          }),
        ),
      );
      expect(yield* Ref.get(reads)).toBe(1);
    }),
);

it.effect(
  "PR workflow calls reject before project resolution when the optional port is absent",
  () =>
    Effect.gen(function* () {
      const projects = yield* Ref.make(0);
      const forged = yield* WorkflowForge.WorkflowForge.pipe(
        Effect.provide(
          WorkflowForge.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(IssueService.IssueService)({}),
                Layer.mock(ProjectService.ProjectService)({
                  getByWorkspaceRoot: () =>
                    Ref.update(projects, (count) => count + 1).pipe(Effect.as(Option.none())),
                }),
              ),
            ),
          ),
        ),
      );
      const address = { project: "/fixture", url: "https://github.com/example/project/pull/123" };
      for (const operation of [
        forged.pullRequests.list({ project: "/fixture" }),
        forged.pullRequests.read(address),
        forged.pullRequests.comment(address, "Do not send this"),
        forged.pullRequests.act(address, "merge"),
      ]) {
        expect(yield* operation.pipe(Effect.flip)).toMatchObject({
          _tag: "WorkflowForgeError",
          reason: "Pull requests are unavailable in this product profile.",
        });
      }
      expect(yield* Ref.get(projects)).toBe(0);
    }),
);
