import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { checkEntry, checkDependencies } from "./checkPrGraph.ts";

const fixture = Effect.fn("PrGraphTest.fixture")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "paperkite-pr-graph-" });
  const write = Effect.fn("PrGraphTest.write")(function* (file: string, text: string) {
    const target = path.join(root, file);
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    yield* fs.writeFileString(target, text);
  });
  yield* write(
    "apps/web/tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        paths: { "~/*": ["./src/*"] },
      },
    }),
  );
  yield* write("apps/server/tsconfig.json", "{}");
  return { root, write };
});

it.effect("finds transitive alias/dynamic PR imports but permits erased compatibility types", () =>
  Effect.gen(function* () {
    const { root, write } = yield* fixture();
    yield* write("apps/web/src/bootstrap.ts", 'export const boot = import("~/bridge");');
    yield* write("apps/web/src/bridge.ts", 'export { value } from "./state/pullRequests";');
    yield* write(
      "apps/web/src/state/pullRequests.ts",
      'export const value = "pr"; export type Pr = string;',
    );
    expect(
      yield* checkEntry(root, "apps/web/src/bootstrap.ts", "web").pipe(Effect.flip),
    ).toMatchObject({
      _tag: "PullRequestGraphError",
      modules: ["apps/web/src/state/pullRequests.ts"],
    });
    yield* write(
      "apps/web/src/bridge.ts",
      'import url from "./state/pullRequests.ts?worker&url"; export { url };',
    );
    const resource = yield* checkEntry(root, "apps/web/src/bootstrap.ts", "web").pipe(Effect.flip);
    expect(resource._tag).toBe("PullRequestGraphError");
    if (resource._tag === "PullRequestGraphError") {
      expect(resource.modules).toContain("apps/web/src/state/pullRequests.ts");
    }
    yield* write(
      "apps/web/src/bridge.ts",
      'import type { Pr } from "./state/pullRequests"; export const value: Pr = "document";',
    );
    expect(yield* checkEntry(root, "apps/web/src/bootstrap.ts", "web")).toBeGreaterThan(0);
    yield* write("apps/web/src/bridge.ts", 'export { value } from "./missing";');
    expect(
      yield* checkEntry(root, "apps/web/src/bootstrap.ts", "web").pipe(Effect.flip),
    ).toMatchObject({ _tag: "GraphResolutionError" });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects removed provider package imports but permits plain links and erased types", () =>
  Effect.gen(function* () {
    const { root, write } = yield* fixture();
    for (const specifier of [
      "@t3tools/source-control-gitlab/server/driver",
      "@t3tools/source-control-github/server/driver",
      "@t3tools/source-control-github/shared/definition",
      "@t3tools/source-control-github",
      "@t3tools/source-control-azure-devops/shared/definition",
      "@t3tools/source-control-bitbucket",
      "@t3tools/source-control-cursor-origin/server/driver",
      "@t3tools/source-control-forgejo/shared/definition",
      "@t3tools/source-control-gitcafe/shared/definition",
      "@t3tools/source-control-tanstack-source/server/driver",
      "@t3tools/issue-tracker-linear/shared/issueUrl",
    ]) {
      yield* write(
        "apps/server/src/main.ts",
        `export const load = () => import(${JSON.stringify(specifier)});`,
      );
      expect(
        yield* checkEntry(root, "apps/server/src/main.ts", "server").pipe(Effect.flip),
      ).toMatchObject({ _tag: "ProviderGraphError", modules: [specifier] });
    }
    for (const name of [
      "source-control-github",
      "source-control-gitlab",
      "source-control-azure-devops",
      "source-control-bitbucket",
      "source-control-cursor-origin",
      "source-control-forgejo",
      "source-control-gitcafe",
      "source-control-tanstack-source",
      "issue-tracker-linear",
    ]) {
      yield* write(
        `packages/${name}/src/server/driver.ts`,
        "export const driver = 1; export type LegacyDriver = number;",
      );
      yield* write(
        "apps/server/src/main.ts",
        `export { driver } from "../../../packages/${name}/src/server/driver";`,
      );
      expect(
        yield* checkEntry(root, "apps/server/src/main.ts", "server").pipe(Effect.flip),
      ).toMatchObject({
        _tag: "ProviderGraphError",
        modules: [`packages/${name}/src/server/driver.ts`],
      });
    }
    yield* write(
      "apps/server/src/main.ts",
      'import type { LegacyDriver } from "../../../packages/source-control-github/src/server/driver"; export const plainLink: string = "https://github.com/example/docs";',
    );
    expect(yield* checkEntry(root, "apps/server/src/main.ts", "server")).toBeGreaterThan(0);
    yield* write(
      "apps/web/src/bootstrap.ts",
      'export { prompt } from "./components/GitHubStarPrompt";',
    );
    yield* write("apps/web/src/components/GitHubStarPrompt.tsx", "export const prompt = 1;");
    expect(
      yield* checkEntry(root, "apps/web/src/bootstrap.ts", "web").pipe(Effect.flip),
    ).toMatchObject({
      _tag: "ProviderGraphError",
      modules: ["apps/web/src/components/GitHubStarPrompt.tsx"],
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live(
  "rejects every transitive removed provider dependency while allowing unreachable upstream sources",
  () =>
    Effect.gen(function* () {
      const { root, write } = yield* fixture();
      yield* write("package.json", '{"name":"fixture","private":true}');
      yield* write("pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");
      yield* write(
        "apps/server/package.json",
        '{"name":"t3","dependencies":{"definitions":"workspace:*"}}',
      );
      yield* write(
        "apps/web/package.json",
        '{"name":"@t3tools/web","dependencies":{"definitions":"workspace:*"}}',
      );
      for (const name of [
        "@t3tools/source-control-gitlab",
        "@t3tools/source-control-github",
        "@t3tools/source-control-azure-devops",
        "@t3tools/source-control-bitbucket",
        "@t3tools/source-control-cursor-origin",
        "@t3tools/source-control-forgejo",
        "@t3tools/source-control-gitcafe",
        "@t3tools/source-control-tanstack-source",
        "@t3tools/issue-tracker-linear",
      ]) {
        yield* write(
          `packages/${name.slice("@t3tools/".length)}/package.json`,
          JSON.stringify({ name }),
        );
        yield* write(
          "packages/definitions/package.json",
          JSON.stringify({
            name: "definitions",
            dependencies: { [name]: "workspace:*" },
          }),
        );
        expect(yield* checkDependencies(root).pipe(Effect.flip)).toMatchObject({
          _tag: "ProviderGraphError",
          modules: [name],
        });
      }
      yield* write(
        "packages/definitions/package.json",
        '{"name":"definitions","dependencies":{"t3":"workspace:*"}}',
      );
      expect(yield* checkDependencies(root)).toBe(3);
      const native = yield* ChildProcessSpawner.ChildProcessSpawner;
      const unsuccessful = ChildProcessSpawner.make((command) =>
        native.spawn(command).pipe(
          Effect.map((handle) => ({
            ...handle,
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
          })),
        ),
      );
      expect(
        yield* checkDependencies(root).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, unsuccessful),
          Effect.flip,
        ),
      ).toMatchObject({ _tag: "GraphResolutionError" });
      yield* write("apps/web/package.json", '{"name":"detached-web"}');
      expect(yield* checkDependencies(root).pipe(Effect.flip)).toMatchObject({
        _tag: "GraphResolutionError",
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects issue implementations and account forms without constructing them", () =>
  Effect.gen(function* () {
    const { root, write } = yield* fixture();
    for (const [surface, module] of [
      ["server", "issue/IssueService.ts"],
      ["server", "issue/IssueTrackerConnections.ts"],
      ["server", "orchestration-v2/ThreadIssueService.ts"],
      ["server", "mcp/toolkits/issues/handlers.ts"],
      ["web", "components/issue/IssueDetailPanel.tsx"],
      ["web", "components/settings/SourceControlSettings.tsx"],
      ["web", "components/settings/IssueTrackerSettings.tsx"],
    ] as const) {
      yield* write(`apps/${surface}/src/${module}`, "export const value = 1;");
      yield* write(`apps/${surface}/src/main.ts`, `export { value } from "./${module}";`);
      expect(
        yield* checkEntry(root, `apps/${surface}/src/main.ts`, surface).pipe(Effect.flip),
      ).toMatchObject({ _tag: "IssueGraphError", modules: [`apps/${surface}/src/${module}`] });
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects direct and transitive Git implementation roots, not erased history types", () =>
  Effect.gen(function* () {
    const { root, write } = yield* fixture();
    for (const module of [
      "vcs/GitVcsDriver.ts",
      "vcs/VcsProcess.ts",
      "git/GitManager.ts",
      "workspace/restoreMissingWorktree.ts",
      "workspace/TaskFolders.ts",
      "checkpointing/CheckpointStore.ts",
      "project/ProjectCloneTracker.ts",
      "mcp/toolkits/worktree/handlers.ts",
    ]) {
      yield* write(
        `apps/server/src/${module}`,
        "export const value = 1; export type History = string;",
      );
      yield* write("apps/server/src/main.ts", `export { value } from "./${module}";`);
      expect(
        yield* checkEntry(root, "apps/server/src/main.ts", "server").pipe(Effect.flip),
      ).toMatchObject({ _tag: "GitGraphError", modules: [`apps/server/src/${module}`] });
    }
    yield* write(
      "apps/server/src/main.ts",
      'import type { History } from "./vcs/GitVcsDriver.ts"; export const history: History = "opaque";',
    );
    expect(yield* checkEntry(root, "apps/server/src/main.ts", "server")).toBeGreaterThan(0);
    // An inline type specifier keeps the module's side effects under verbatimModuleSyntax.
    yield* write("apps/server/tsconfig.json", '{"compilerOptions":{"verbatimModuleSyntax":true}}');
    yield* write(
      "apps/server/src/main.ts",
      'import { type History } from "./vcs/GitVcsDriver.ts"; export const history: History = "opaque";',
    );
    expect(
      yield* checkEntry(root, "apps/server/src/main.ts", "server").pipe(Effect.flip),
    ).toMatchObject({
      _tag: "GitGraphError",
      modules: ["apps/server/src/vcs/GitVcsDriver.ts"],
      paths: [["apps/server/src/main.ts", "apps/server/src/vcs/GitVcsDriver.ts"]],
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "rejects literal Git processes outside named Git modules but permits help text and types",
  () =>
    Effect.gen(function* () {
      const { root, write } = yield* fixture();
      const entry = "apps/server/src/main.ts";
      for (const source of [
        'export const request = {command: "git", args: ["status"]};',
        'import * as ChildProcess from "effect/process/ChildProcess"; export const request = ChildProcess.make("git", ["status"]);',
        'import * as ChildProcess from "node:child_process"; export const child = ChildProcess.spawn("/usr/bin/git", ["status"]);',
      ]) {
        yield* write(entry, source);
        expect(yield* checkEntry(root, entry, "server").pipe(Effect.flip)).toMatchObject({
          _tag: "GitGraphError",
          modules: [entry],
        });
      }
      yield* write(
        entry,
        [
          "export const hint = 'Example: ChildProcess.make(\\\"git\\\")';",
          'export type Metadata = { command: "git" };',
          '// ChildProcess.make("git") is documentation only.',
        ].join("\n"),
      );
      expect(yield* checkEntry(root, entry, "server")).toBeGreaterThan(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("rejects a Git-backed native finder even when hidden behind createRequire", () =>
  Effect.gen(function* () {
    const { root, write } = yield* fixture();
    yield* write("package.json", '{"name":"fixture","private":true}');
    yield* write("pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");
    yield* write(
      "apps/server/package.json",
      '{"name":"t3","dependencies":{"@ff-labs/fff-node":"workspace:*"}}',
    );
    yield* write("apps/web/package.json", '{"name":"@t3tools/web"}');
    yield* write("packages/finder/package.json", '{"name":"@ff-labs/fff-node"}');
    expect(yield* checkDependencies(root).pipe(Effect.flip)).toMatchObject({
      _tag: "GitGraphError",
      modules: ["@ff-labs/fff-node"],
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("detects server worker imports even without constructing the worker", () =>
  Effect.gen(function* () {
    const { root, write } = yield* fixture();
    yield* write(
      "apps/server/src/main.ts",
      'export const worker = import("./orchestration-v2/PullRequestWatchReactor");',
    );
    yield* write(
      "apps/server/src/orchestration-v2/PullRequestWatchReactor.ts",
      "export const start = () => {};",
    );
    expect(
      yield* checkEntry(root, "apps/server/src/main.ts", "server").pipe(Effect.flip),
    ).toMatchObject({
      _tag: "PullRequestGraphError",
      modules: ["apps/server/src/orchestration-v2/PullRequestWatchReactor.ts"],
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
