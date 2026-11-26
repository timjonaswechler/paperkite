import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { build } from "esbuild";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Command, Flag } from "effect/cli";

export class PullRequestGraphError extends Schema.TaggedError<PullRequestGraphError>()(
  "PullRequestGraphError",
  { modules: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `Excluded pull-request modules remain reachable: ${this.modules.join(", ")}`;
  }
}

export class ProviderGraphError extends Schema.TaggedError<ProviderGraphError>()(
  "ProviderGraphError",
  {
    modules: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Excluded provider package imports or dependencies remain reachable: ${this.modules.join(", ")}`;
  }
}

export class IssueGraphError extends Schema.TaggedError<IssueGraphError>()("IssueGraphError", {
  modules: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `Excluded issue/account modules remain reachable: ${this.modules.join(", ")}`;
  }
}

export class GitGraphError extends Schema.TaggedError<GitGraphError>()("GitGraphError", {
  modules: Schema.Array(Schema.String),
  paths: Schema.optionalKey(Schema.Array(Schema.Array(Schema.String))),
}) {
  override get message(): string {
    return `Git implementations remain reachable: ${this.modules.join(", ")}`;
  }
}

class GraphResolutionError extends Schema.TaggedError<GraphResolutionError>()(
  "GraphResolutionError",
  { entry: Schema.String, cause: Schema.Defect() },
) {}

const excluded = [
  /apps\/server\/src\/pullRequest\/(?!http\.ts$)/,
  /apps\/server\/src\/orchestration-v2\/(?:PullRequestSyncReactor|PullRequestWatchReactor|ThreadPullRequestService)\.ts$/,
  /apps\/server\/src\/mcp\/toolkits\/pullRequests\//,
  /apps\/web\/src\/components\/pullRequest\/(?:LinkPullRequestDialog|ThreadPullRequestsPanel|PullRequests(?:Page|Column)|PullRequest(?:DetailPanel|SummaryTab|CodeTab|GuideTab|TimelineTab|LinkPreview|Composer|MarkdownTextarea|MarkdownEditor|Reactions|ListFilters|ReviewForm|ActionsMenu|StackLayers))\.tsx$/,
  /apps\/web\/src\/components\/pullRequest\/(?:usePullRequest\w*|useThreadLinkedPullRequest)\.ts$/,
  /apps\/web\/src\/components\/PullRequest(?:ContextDetails|ThreadDialog)\.tsx$/,
  /apps\/web\/src\/components\/settings\/PullRequestRoutingSettings\.tsx$/,
  /apps\/web\/src\/state\/(?:pullRequests|usePullRequestStack)\.ts$/,
  /apps\/web\/src\/hooks\/(?:usePullRequest\w*|useSupportsMultiplePullRequests|useOpenPanelPullRequestUrl)\.ts$/,
  /apps\/web\/src\/routes\/_chat\.pull-requests\.tsx$/,
];

const excludedProviderPackages = [
  "@t3tools/source-control-github",
  "@t3tools/source-control-gitlab",
  "@t3tools/source-control-azure-devops",
  "@t3tools/source-control-bitbucket",
  "@t3tools/source-control-cursor-origin",
  "@t3tools/source-control-forgejo",
  "@t3tools/source-control-gitcafe",
  "@t3tools/source-control-tanstack-source",
  "@t3tools/issue-tracker-linear",
];
const providerRuntimeModule =
  /(?:^|\/)packages\/(?:source-control-(?:github|gitlab|azure-devops|bitbucket|cursor-origin|forgejo|gitcafe|tanstack-source)|issue-tracker-linear)\/src\/|apps\/web\/src\/components\/GitHubStarPrompt\.tsx$/;
const providerRuntimeImport =
  /^@t3tools\/(?:source-control-(?:github|gitlab|azure-devops|bitbucket|cursor-origin|forgejo|gitcafe|tanstack-source)|issue-tracker-linear)(?:$|\/)/;

const excludedGitModules = [
  /apps\/server\/src\/git\//,
  /apps\/server\/src\/vcs\/(?:GitVcsDriver|GitVcsDriverCore|VcsProcess|VcsDriverRegistry|VcsProvisioningService|VcsStatusBroadcaster)\.ts$/,
  /apps\/server\/src\/checkpointing\/(?:CheckpointStore|CheckpointDiffQuery)\.ts$/,
  /apps\/server\/src\/workspace\/(?:TaskFolders|restoreMissingWorktree)\.ts$/,
  /apps\/server\/src\/project\/(?:ProjectCloneTracker|WorktreeSetupTracker)\.ts$/,
  /apps\/server\/src\/mcp\/toolkits\/worktree\//,
  /apps\/web\/src\/components\/(?:BranchToolbar|WorktreeBaseBranchPicker|GitActionsControl)/,
  /apps\/web\/src\/state\/(?:branchQueries|vcs|sourceControl)\.ts$/,
];

function containsGitProcess(source: string): boolean {
  // Tokenize quoted data atomically so help text is not mistaken for an executable request.
  const tokens =
    source.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g) ??
    [];
  const git = (token: string | undefined) =>
    token !== undefined &&
    ["'", '"', "`"].includes(token[0] ?? "") &&
    /(?:^|[\\/])git(?:\.exe)?$/iu.test(token.slice(1, -1));
  return tokens.some(
    (token, index) =>
      (token === "command" && tokens[index + 1] === ":" && git(tokens[index + 2])) ||
      ((token === "spawn" ||
        token === "execFile" ||
        token === "exec" ||
        token === "execSync" ||
        (token === "make" && /ChildProcess\d*$/.test(tokens[index - 2] ?? ""))) &&
        tokens[index + 1] === "(" &&
        git(tokens[index + 2])),
  );
}

const excludedGitPackages = [
  "@ff-labs/fff-node",
  "isomorphic-git",
  "simple-git",
  "nodegit",
  "dugite",
];

const excludedIssueModules = [
  /apps\/server\/src\/issue\/(?:IssueService|IssueTrackerConnections)\.ts$/,
  /apps\/server\/src\/orchestration-v2\/ThreadIssueService\.ts$/,
  /apps\/server\/src\/mcp\/toolkits\/issues\//,
  /apps\/web\/src\/components\/issue\/.*\.tsx$/,
  /apps\/web\/src\/components\/chat\/ThreadDetailsIssueRows\.tsx$/,
  /apps\/web\/src\/components\/settings\/(?:SourceControlSettings|IssueTrackerSettings)\.tsx$/,
  /apps\/web\/src\/state\/(?:issues|issueTrackers)\.ts$/,
  /apps\/web\/src\/lib\/openIssueLink\.ts$/,
];

/** Check local source edges and external import names without transforming React or bundling packages. */
export const checkEntry = Effect.fn("Paperkite.checkPrGraph")(function* (
  root: string,
  entry: string,
  surface: "server" | "web",
) {
  const path = yield* Path.Path;
  const result = yield* Effect.tryPromise({
    try: () =>
      build({
        absWorkingDir: root,
        entryPoints: [entry],
        tsconfig: path.join(root, "apps", surface, "tsconfig.json"),
        platform: surface === "server" ? "node" : "browser",
        format: "esm",
        bundle: true,
        packages: "external",
        write: false,
        metafile: true,
        minifyWhitespace: true,
        legalComments: "none",
        outdir: path.join(root, ".pr-graph-unused"),
        logLevel: "silent",
        external: [
          "*.css",
          "*.svg",
          "*.png",
          "*.jpg",
          "*.gif",
          "*.webp",
          "*.woff",
          "*.woff2",
          "*.wasm",
          "*.mp3",
          "*.glb",
        ],
        plugins: [
          {
            name: "vite-resource-query",
            setup(builder) {
              builder.onResolve({ filter: /\?/ }, async (args) => {
                const [source, query] = args.path.split("?");
                const resolved = await builder.resolve(source!, {
                  importer: args.importer,
                  resolveDir: args.resolveDir,
                  kind: args.kind,
                });
                return !resolved.external &&
                  /\.[cm]?[jt]sx?$/.test(resolved.path) &&
                  new URLSearchParams(query).has("url")
                  ? { ...resolved, namespace: "vite-url-source" }
                  : resolved;
              });
              builder.onResolve({ filter: /.*/, namespace: "vite-url-source" }, ({ path }) => ({
                path,
                namespace: "file",
              }));
              builder.onLoad({ filter: /.*/, namespace: "vite-url-source" }, ({ path }) => ({
                contents: `import ${JSON.stringify(path)}; export default "/graph-only-resource";`,
                loader: "js",
              }));
            },
          },
        ],
      }),
    catch: (cause) => new GraphResolutionError({ entry, cause }),
  });
  const modules = Object.keys(result.metafile.inputs).map((file) => file.replaceAll("\\", "/"));
  if (surface === "server") {
    if (!result.outputFiles?.length)
      return yield* new GraphResolutionError({
        entry,
        cause: new Error("Missing source graph output."),
      });
    if (result.outputFiles.some((file) => containsGitProcess(file.text)))
      return yield* new GitGraphError({
        modules: [entry],
        paths: [[entry, "literal Git process"]],
      });
  }
  const forbidden = modules.filter((file) => excluded.some((pattern) => pattern.test(file)));
  if (forbidden.length > 0) return yield* new PullRequestGraphError({ modules: forbidden });
  const issues = modules.filter((file) =>
    excludedIssueModules.some((pattern) => pattern.test(file)),
  );
  if (issues.length > 0) return yield* new IssueGraphError({ modules: issues });
  const git = modules.filter((file) => excludedGitModules.some((pattern) => pattern.test(file)));
  if (git.length > 0) {
    const paths = new Map<string, ReadonlyArray<string>>([[entry, [entry]]]);
    const pending = [entry];
    for (let index = 0; index < pending.length; index++) {
      const importer = pending[index]!;
      for (const edge of result.metafile.inputs[importer]?.imports ?? []) {
        if (edge.external || paths.has(edge.path)) continue;
        paths.set(edge.path, [...paths.get(importer)!, edge.path]);
        pending.push(edge.path);
      }
    }
    return yield* new GitGraphError({
      modules: git,
      paths: git.map((module) => [...(paths.get(module) ?? [module])]),
    });
  }
  const providers = [
    ...modules.filter((file) => providerRuntimeModule.test(file)),
    ...Object.values(result.metafile.inputs).flatMap((input) =>
      input.imports
        .filter((item) => item.external && providerRuntimeImport.test(item.path))
        .map((item) => item.path),
    ),
  ];
  if (providers.length > 0)
    return yield* new ProviderGraphError({ modules: [...new Set(providers)] });
  return modules.length;
});

const decodeWorkspacePackages = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
        devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
        optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
      }),
    ),
  ),
);

export const checkDependencies = Effect.fn("Paperkite.checkProductDependencies")(function* (
  root: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const [output, exitCode] = yield* Effect.gen(function* () {
    const handle = yield* spawner.spawn(
      ChildProcess.make(
        "pnpm",
        [
          "--config.verify-deps-before-run=error",
          "--filter",
          "t3...",
          "--filter",
          "@t3tools/web...",
          "list",
          "--depth",
          "0",
          "--json",
        ],
        { cwd: root },
      ),
    );
    return yield* Effect.all(
      [
        Stream.mkString(Stream.decodeText(handle.stdout)),
        handle.exitCode,
        Stream.runDrain(handle.stderr),
      ],
      { concurrency: "unbounded" },
    );
  }).pipe(
    Effect.scoped,
    Effect.mapError(
      (cause) => new GraphResolutionError({ entry: "workspace-dependencies", cause }),
    ),
  );
  if (exitCode !== 0)
    return yield* new GraphResolutionError({
      entry: "workspace-dependencies",
      cause: new Error(`Workspace package listing exited with code ${exitCode}.`),
    });
  const packages = yield* decodeWorkspacePackages(output).pipe(
    Effect.mapError(
      (cause) => new GraphResolutionError({ entry: "workspace-dependencies", cause }),
    ),
  );
  const names = new Set(packages.map((item) => item.name));
  if (!names.has("t3") || !names.has("@t3tools/web"))
    return yield* new GraphResolutionError({
      entry: "workspace-dependencies",
      cause: new Error("Product roots are missing from the workspace dependency graph."),
    });
  const dependencyNames = new Set([
    ...names,
    ...packages.flatMap((item) => [
      ...Object.keys(item.dependencies ?? {}),
      ...Object.keys(item.devDependencies ?? {}),
      ...Object.keys(item.optionalDependencies ?? {}),
    ]),
  ]);
  const git = excludedGitPackages.filter((name) => dependencyNames.has(name));
  if (git.length > 0) return yield* new GitGraphError({ modules: git });
  const providers = excludedProviderPackages.filter((name) => names.has(name));
  if (providers.length > 0) return yield* new ProviderGraphError({ modules: providers });
  return names.size;
});

const command = Command.make(
  "check-pr-graph",
  { root: Flag.String("root") },
  Effect.fn("Paperkite.checkPrGraphs")(function* ({ root }) {
    const path = yield* Path.Path;
    const absolute = path.resolve(root);
    yield* checkDependencies(absolute);
    yield* checkEntry(absolute, "apps/server/src/paperkite/main.ts", "server");
    yield* checkEntry(absolute, "apps/server/src/paperkite/native-cli.ts", "server");
    yield* checkEntry(absolute, "apps/web/src/bootstrap.ts", "web");
    yield* Console.log(
      "Paperkite server, CLI and web graphs exclude Git/PR/issue/account implementations, literal Git processes and retired forge/Linear dependencies.",
    );
  }),
);

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
