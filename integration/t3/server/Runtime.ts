import {
  PullRequestUnavailableError,
  RpcFeatureAvailability,
  GitUnavailableError,
  EnvironmentFeatureUnavailableError,
  ReviewCommentContextRecord,
  ThreadLinkedPullRequest,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { RuntimeStatus } from "@paperkite/contracts/runtime";
import upstream from "./upstream.json" with { type: "json" };
import * as RuntimePolicy from "@paperkite/core/RuntimePolicy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export const status = (profile: RuntimeStatus["profile"]): RuntimeStatus => ({
  application: "paperkite",
  upstreamCommit: upstream.commit,
  profile,
  capabilities: {
    threadSettlement: profile === "native",
    pullRequests: false,
    git: false,
    github: false,
    sourceControl: false,
    issues: false,
    pairing: false,
    environments: false,
  },
});

export const Profile = Context.Reference<RuntimeStatus | undefined>("paperkite/t3/Profile", {
  defaultValue: () => undefined,
});

export const settlementEnabled = Effect.map(
  Profile,
  (profile) => profile?.capabilities.threadSettlement !== false,
);

export const gitEnabled = Effect.map(Profile, (profile) => profile?.capabilities.git !== false);
export const githubEnabled = Effect.map(
  Profile,
  (profile) => profile?.capabilities.github !== false,
);
export const sourceControlEnabled = Effect.map(
  Profile,
  (profile) => profile?.capabilities.sourceControl !== false,
);
export const issuesEnabled = Effect.map(
  Profile,
  (profile) => profile?.capabilities.issues !== false,
);
export const requireSourceControl = Effect.flatMap(sourceControlEnabled, (enabled) =>
  enabled
    ? Effect.void
    : Effect.fail(new EnvironmentFeatureUnavailableError({ feature: "sourceControl" })),
);
export const requireIssues = Effect.flatMap(issuesEnabled, (enabled) =>
  enabled
    ? Effect.void
    : Effect.fail(new EnvironmentFeatureUnavailableError({ feature: "issues" })),
);
export const pairingEnabled = Effect.map(
  Profile,
  (profile) => profile?.capabilities.pairing !== false,
);
export const environmentsEnabled = Effect.map(
  Profile,
  (profile) => profile?.capabilities.environments !== false,
);
export const requirePairing = Effect.flatMap(pairingEnabled, (enabled) =>
  enabled
    ? Effect.void
    : Effect.fail(new EnvironmentFeatureUnavailableError({ feature: "pairing" })),
);
export const requireEnvironments = Effect.flatMap(environmentsEnabled, (enabled) =>
  enabled
    ? Effect.void
    : Effect.fail(new EnvironmentFeatureUnavailableError({ feature: "environments" })),
);

export const pullRequestsEnabled = Effect.map(
  Profile,
  (profile) => profile?.capabilities.pullRequests !== false,
);

export const requirePullRequests = Effect.flatMap(pullRequestsEnabled, (enabled) =>
  enabled
    ? Effect.void
    : Effect.fail(new PullRequestUnavailableError({ reason: "feature-disabled" })),
);

export const requireGit = Effect.flatMap(gitEnabled, (enabled) =>
  enabled ? Effect.void : Effect.fail(new GitUnavailableError({ reason: "feature-disabled" })),
);

const gitRpcMethods = new Set<string>([
  WS_METHODS.sourceControlLookupRepository,
  WS_METHODS.sourceControlCloneRepository,
  WS_METHODS.sourceControlPublishRepository,
  WS_METHODS.projectCloneStart,
  WS_METHODS.projectCloneCancel,
  WS_METHODS.projectCloneRetry,
  WS_METHODS.subscribeProjectClones,
  WS_METHODS.workspaceAddTaskFolderRepository,
  WS_METHODS.subscribeVcsStatus,
  WS_METHODS.subscribeVcsBranch,
  WS_METHODS.subscribeWorktreeSetup,
  WS_METHODS.worktreeSetupCancel,
  "orchestration.getTurnDiff",
  "orchestration.getFullThreadDiff",
  "orchestration.getWorktreeThreadIds",
]);

const isStackedPullRequestAction = Schema.is(
  Schema.Struct({
    action: Schema.Literals(["create_pr", "commit_push_pr"]),
  }),
);

export const requireRpc = Effect.fn("Paperkite.requireRpc")(function* (
  method: string,
  payload: unknown,
) {
  if (method.startsWith("peerLinks.")) yield* requireEnvironments;
  if (method.startsWith("issues.") || method.startsWith("issueTrackers.")) yield* requireIssues;
  if (
    (method.startsWith("sourceControl.") && !gitRpcMethods.has(method)) ||
    method === WS_METHODS.serverDiscoverSourceControl
  )
    yield* requireSourceControl;
  if (
    method.startsWith("pullRequests.") ||
    method === WS_METHODS.gitResolvePullRequest ||
    method === WS_METHODS.gitPreparePullRequestThread ||
    (method === WS_METHODS.gitRunStackedAction && isStackedPullRequestAction(payload))
  )
    yield* requirePullRequests;
  if (
    method.startsWith("vcs.") ||
    method.startsWith("git.") ||
    method.startsWith("review.") ||
    gitRpcMethods.has(method) ||
    requestsGitWorkspace(payload)
  )
    yield* requireGit;
});

export const layerRpcAvailability = Layer.effect(
  RpcFeatureAvailability,
  Effect.gen(function* () {
    const profile = yield* Profile;
    return RpcFeatureAvailability.of((effect, { rpc, payload }) =>
      requireRpc(rpc._tag, payload).pipe(
        Effect.provideService(Profile, profile),
        Effect.andThen(effect),
      ),
    );
  }),
);

export const isPullRequestTool = (name: string): boolean =>
  name.includes("pull_request") || name === "ci_logs" || name === "ci_rerun";

export const isEnvironmentTool = (name: string): boolean =>
  name === "t3_environment_links" ||
  name === "t3_environment_link" ||
  name === "t3_environment_unlink";

export const isGitTool = (name: string): boolean =>
  name.startsWith("t3_worktree_") || name === "t3_project_clone";

const hasWorktreeIsolation = Schema.is(Schema.Struct({ isolation: Schema.Literal("worktree") }));
const hasBranch = Schema.is(Schema.Struct({ branch: Schema.String }));
const hasWorktreePath = Schema.is(Schema.Struct({ worktreePath: Schema.String }));
const hasWorkspaceStrategy = Schema.is(Schema.Struct({ workspaceStrategy: Schema.Unknown }));
const hasLaunch = Schema.is(Schema.Struct({ launch: Schema.Unknown }));
const isRootWorkspace = Schema.is(Schema.Struct({ type: Schema.Literal("root") }));
const isConversationOnlyRollback = Schema.is(
  Schema.Struct({ restoreFiles: Schema.Literal(false) }),
);

export const requestsGitWorkspace = (payload: unknown): boolean =>
  hasBranch(payload) ||
  hasWorktreeIsolation(payload) ||
  hasWorktreePath(payload) ||
  (hasWorkspaceStrategy(payload) &&
    (!isRootWorkspace(payload.workspaceStrategy) || hasBranch(payload.workspaceStrategy))) ||
  (hasLaunch(payload) && requestsGitWorkspace(payload.launch));

const isLinkedPullRequestCommand = Schema.is(
  Schema.Struct({
    linkedPullRequest: Schema.NullOr(ThreadLinkedPullRequest),
  }),
);
const isMessageContextCommand = Schema.is(
  Schema.Struct({
    context: Schema.Struct({ records: Schema.Array(Schema.Unknown) }),
  }),
);
const isReviewCommentContext = Schema.is(ReviewCommentContextRecord);

export const requireCommand = Effect.fn("Paperkite.requireCommand")(function* (
  type: string,
  payload?: unknown,
) {
  const profile = yield* Profile;
  if (profile === undefined) return;
  if (type.startsWith("thread.issue.")) yield* requireIssues;
  const prContext =
    isMessageContextCommand(payload) &&
    payload.context.records.some(
      (record) => isReviewCommentContext(record) && record.pullRequest !== undefined,
    );
  if (type.startsWith("thread.pull-request") || isLinkedPullRequestCommand(payload) || prContext) {
    const policy = yield* RuntimePolicy.RuntimePolicy.pipe(
      Effect.provide(RuntimePolicy.layer(profile)),
    );
    yield* policy.requirePullRequests;
  }
  if (
    requestsGitWorkspace(payload) ||
    (type === "checkpoint.rollback" && !isConversationOnlyRollback(payload))
  ) {
    const policy = yield* RuntimePolicy.RuntimePolicy.pipe(
      Effect.provide(RuntimePolicy.layer(profile)),
    );
    yield* policy.requireGit;
  }
  if (!["thread.settle", "thread.auto-settle", "thread.unsettle"].includes(type)) return;
  const policy = yield* RuntimePolicy.RuntimePolicy.pipe(
    Effect.provide(RuntimePolicy.layer(profile)),
  );
  yield* policy.requireThreadSettlement;
});

export const whenEnvironmentsEnabled = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  Layer.unwrap(Effect.map(environmentsEnabled, (enabled) => (enabled ? layer : Layer.empty)));

export const whenGitEnabled = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  Layer.unwrap(Effect.map(gitEnabled, (enabled) => (enabled ? layer : Layer.empty)));

export const whenSettlementEnabled = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  Layer.unwrap(Effect.map(settlementEnabled, (enabled) => (enabled ? layer : Layer.empty)));
