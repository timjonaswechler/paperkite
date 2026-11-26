import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type { RuntimeStatus } from "@paperkite/contracts/runtime";
import * as Runtime from "./Runtime.ts";

const proof: RuntimeStatus = {
  application: "paperkite",
  upstreamCommit: "fixture",
  profile: "proof",
  capabilities: {
    threadSettlement: false,
    pullRequests: false,
    git: false,
    pairing: false,
    environments: false,
    github: false,
    sourceControl: false,
    issues: false,
  },
};

it.effect(
  "rejects every explicit settlement mutation but leaves unrelated native commands available",
  () =>
    Effect.gen(function* () {
      for (const type of ["thread.settle", "thread.auto-settle", "thread.unsettle"]) {
        const result = yield* Runtime.requireCommand(type).pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.failure._tag).toBe("PaperkiteFeatureUnavailable");
          expect(result.failure.feature).toBe("threadSettlement");
        }
      }
      yield* Runtime.requireCommand("thread.create");
    }).pipe(Effect.provideService(Runtime.Profile, proof)),
);

it.effect("does not construct the disabled worker, and starts the enabled native worker once", () =>
  Effect.gen(function* () {
    for (const enabled of [false, true]) {
      const starts = yield* Ref.make(0);
      const worker = Layer.effectDiscard(Ref.update(starts, (count) => count + 1));
      yield* Layer.build(Runtime.whenSettlementEnabled(worker)).pipe(
        Effect.provideService(Runtime.Profile, {
          ...proof,
          capabilities: {
            threadSettlement: enabled,
            pullRequests: false,
            git: false,
            pairing: false,
            environments: false,
            github: false,
            sourceControl: false,
            issues: false,
          },
        }),
        Effect.scoped,
      );
      expect(yield* Ref.get(starts)).toBe(enabled ? 1 : 0);
    }
  }),
);

it.effect("rejects issue link mutations before side effects without blocking ordinary chat", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    for (const type of ["thread.issue.link", "thread.issue.unlink"]) {
      expect(
        yield* Runtime.requireCommand(type).pipe(
          Effect.andThen(Ref.update(calls, (count) => count + 1)),
          Effect.flip,
        ),
      ).toMatchObject({ _tag: "EnvironmentFeatureUnavailableError", feature: "issues" });
    }
    expect(yield* Ref.get(calls)).toBe(0);
    yield* Runtime.requireCommand("message.dispatch", {
      text: "https://linear.app/acme/issue/T-7",
    });
  }).pipe(Effect.provideService(Runtime.Profile, proof)),
);

it.effect("rejects PR link and watch commands while allowing native chat commands", () =>
  Effect.gen(function* () {
    for (const type of [
      "thread.pull-request.link",
      "thread.pull-request.unlink",
      "thread.pull-request.watch",
      "thread.pull-request.sync",
      "thread.pull-request-link.sync",
    ]) {
      expect(yield* Runtime.requireCommand(type).pipe(Effect.flip)).toMatchObject({
        _tag: "PaperkiteFeatureUnavailable",
        feature: "pullRequests",
      });
    }
    yield* Runtime.requireCommand("message.dispatch");
    yield* Runtime.requireCommand("thread.fork");
    expect(
      yield* Runtime.requireRpc("git.runStackedAction", { action: "commit" }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "GitUnavailableError" });
  }).pipe(Effect.provideService(Runtime.Profile, proof)),
);

it.effect(
  "rejects legacy links and structured PR context, not plain text or document comparisons",
  () =>
    Effect.gen(function* () {
      expect(
        yield* Runtime.requireCommand("thread.update", { linkedPullRequest: null }).pipe(
          Effect.flip,
        ),
      ).toMatchObject({ feature: "pullRequests" });
      const review = {
        version: 1,
        contextId: "review",
        label: "Document comparison",
        kind: "review-comment",
        sectionId: "section",
        sectionTitle: "Changes",
        filePath: "letter.md",
        startIndex: 2,
        endIndex: 5,
        rangeLabel: "2-5",
        text: "Revise this",
        diff: "-old\n+new",
      };
      yield* Runtime.requireCommand("message.dispatch", {
        text: "#123",
        context: { records: [review] },
      });
      expect(
        yield* Runtime.requireCommand("message.dispatch", {
          context: {
            records: [
              {
                ...review,
                pullRequest: {
                  number: 123,
                  title: "Fixture",
                  url: "https://github.com/fixture/fixture/pull/123",
                  headBranch: "feature",
                  baseBranch: "main",
                  state: "open",
                  isDraft: false,
                },
              },
            ],
          },
        }).pipe(Effect.flip),
      ).toMatchObject({ feature: "pullRequests" });
    }).pipe(Effect.provideService(Runtime.Profile, proof)),
);

it.effect("rejects direct Git calls and workspace launches before side effects", () =>
  Effect.gen(function* () {
    for (const method of [
      "vcs.refreshStatus",
      "subscribeVcsStatus",
      "subscribeVcsBranch",
      "git.runStackedAction",
      "review.getDiffPreview",
      "sourceControl.cloneRepository",
      "projectClone.start",
      "orchestration.getTurnDiff",
      "orchestration.getFullThreadDiff",
    ]) {
      const calls = yield* Ref.make(0);
      expect(
        yield* Runtime.requireRpc(method, {}).pipe(
          Effect.andThen(Ref.update(calls, (n) => n + 1)),
          Effect.flip,
        ),
      ).toMatchObject({ _tag: "GitUnavailableError" });
      expect(yield* Ref.get(calls)).toBe(0);
    }
    for (const payload of [
      { branch: "feature" },
      { worktreePath: "/fixture/worktree" },
      { workspaceStrategy: { type: "worktree", baseRef: "main" } },
      { workspaceStrategy: { type: "existing_worktree", worktreePath: "/fixture/worktree" } },
      { workspaceStrategy: { type: "root", branch: "feature" } },
      { launch: { workspaceStrategy: { type: "worktree", baseRef: "main" } } },
    ]) {
      expect(
        yield* Runtime.requireRpc("orchestration.launchThread", payload).pipe(Effect.flip),
      ).toMatchObject({ _tag: "GitUnavailableError" });
      expect(
        yield* Runtime.requireCommand("thread.create", payload).pipe(Effect.flip),
      ).toMatchObject({ feature: "git" });
    }
    for (const restoreFiles of [undefined, true]) {
      expect(
        yield* Runtime.requireCommand("checkpoint.rollback", { restoreFiles }).pipe(Effect.flip),
      ).toMatchObject({ feature: "git" });
    }
    yield* Runtime.requireCommand("checkpoint.rollback", { restoreFiles: false });
    yield* Runtime.requireCommand("thread.create", { branch: null, worktreePath: null });
    yield* Runtime.requireRpc("orchestration.launchThread", {
      workspaceStrategy: { type: "root" },
    });
    yield* Runtime.requireRpc("workspace.readFile", { path: "letter.md" });
    yield* Runtime.requireRpc("workspace.scanFolders", { projectId: "folder-project" });
    yield* Runtime.requireRpc("projects.createNew", { title: "Folder" });
  }).pipe(Effect.provideService(Runtime.Profile, proof)),
);

it.effect("refuses peer RPCs and does not build excluded background workers", () =>
  Effect.gen(function* () {
    for (const method of [
      "peerLinks.names",
      "peerLinks.list",
      "peerLinks.link",
      "peerLinks.pairClient",
    ]) {
      expect(yield* Runtime.requireRpc(method, {}).pipe(Effect.flip)).toMatchObject({
        _tag: "EnvironmentFeatureUnavailableError",
        feature: "environments",
      });
    }
    expect(yield* Runtime.requirePairing.pipe(Effect.flip)).toMatchObject({
      _tag: "EnvironmentFeatureUnavailableError",
      feature: "pairing",
    });
    for (const guard of [Runtime.whenGitEnabled, Runtime.whenEnvironmentsEnabled]) {
      const starts = yield* Ref.make(0);
      yield* Layer.build(guard(Layer.effectDiscard(Ref.update(starts, (n) => n + 1)))).pipe(
        Effect.scoped,
      );
      expect(yield* Ref.get(starts)).toBe(0);
    }
  }).pipe(Effect.provideService(Runtime.Profile, proof)),
);

it.effect("keeps the unprofiled native server compatible", () =>
  Effect.gen(function* () {
    yield* Runtime.requireCommand("thread.settle");
    yield* Runtime.requireCommand("thread.pull-request.link");
    yield* Runtime.requireRpc("pullRequests.list", {});
  }),
);
