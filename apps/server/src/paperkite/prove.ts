import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeWS from "@effect/platform-node/NodeWS";
import {
  CommandId,
  EnvironmentHttpApi,
  ORCHESTRATION_PROTOCOL_VERSION,
  ProjectId,
  ThreadId,
  PaperkiteWsRpcGroup as WsRpcGroup,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { RuntimeStatus } from "@paperkite/contracts/runtime";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RpcClient, RpcSerialization } from "effect/rpc";
import * as Schema from "effect/Schema";
import { Socket } from "effect/socket";
import * as Stream from "effect/Stream";
import * as Isolation from "./integration/Isolation.ts";

class ProofFailure extends Schema.TaggedError<ProofFailure>()("ProofFailure", {
  stage: Schema.String,
}) {
  override get message(): string {
    return `Paperkite proof failed at ${this.stage}.`;
  }
}
const check = (condition: boolean, stage: string) =>
  condition ? Effect.void : Effect.fail(new ProofFailure({ stage }));

const decodeStartedThread = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ threadId: ThreadId })),
);

const isProductDisabled = Schema.is(Schema.Struct({ reason: Schema.Literal("feature-disabled") }));
const isTaggedError = Schema.is(Schema.Struct({ _tag: Schema.String }));
const isPairingDisabled = Schema.is(
  Schema.TaggedStruct("EnvironmentFeatureUnavailableError", {
    feature: Schema.Literal("pairing"),
  }),
);

const prove = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const executable = yield* HostProcess.ExecutablePath;
  const inherited = yield* HostProcess.Environment;
  const root = yield* Config.String("PAPERKITE_ROOT");
  yield* fs.makeDirectory(path.join(root, ".local"), { recursive: true });
  const parent = yield* fs.makeTempDirectoryScoped({
    directory: path.join(root, ".local"),
    prefix: "proof-",
  });
  const homeA = path.join(parent, "a");
  const homeB = path.join(parent, "b");
  yield* Isolation.resolve(root, homeA);
  const command = (file: string, args: ReadonlyArray<string>, home: string) =>
    ChildProcess.make(file, args, {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      extendEnv: false,
      env: {
        PATH: inherited.PATH,
        HOME: inherited.HOME,
        PAPERKITE_ROOT: root,
        PAPERKITE_NODE: executable,
        T3CODE_HOME: home,
        T3CODE_CLI_PATH: path.join(root, "tooling/paperkite"),
      },
    });
  const run = Effect.fn("Paperkite.proof.command")(function* (
    file: string,
    args: ReadonlyArray<string>,
    home: string,
    expectedExitCode = 0,
  ) {
    const child = yield* spawner.spawn(command(file, args, home));
    yield* child.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((line) => Console.error(line)),
      Effect.forkScoped,
    );
    const [output, code] = yield* Effect.all(
      [
        child.stdout.pipe(
          Stream.decodeText(),
          Stream.runFold(
            () => "",
            (all, next) => all + next,
          ),
        ),
        child.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    yield* check(
      code === expectedExitCode,
      `command failed: ${file} ${args[0] ?? ""} (exit ${code}, expected ${expectedExitCode})`,
    );
    return output.trim();
  });
  const cli = (args: ReadonlyArray<string>, home = homeA) =>
    run(path.join(root, "tooling/paperkite"), [...args, "--base-dir", home], home);
  const launch = Effect.fn("Paperkite.proof.launch")(function* (
    home: string,
    profile: "proof" | "native",
  ) {
    const ready = yield* Deferred.make<string>();
    const child = yield* spawner.spawn(
      command(
        executable,
        [
          path.join(root, ".build/t3/apps/server/src/paperkite/main.ts"),
          "--root",
          root,
          "--home",
          home,
          "--port",
          "0",
          "--profile",
          profile,
          "--static-dir",
          path.join(root, ".build/t3/apps/web/dist"),
        ],
        home,
      ),
    );
    yield* child.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((line) => Console.error(line)),
      Effect.forkScoped,
    );
    yield* child.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) =>
        line.startsWith("Connection string: ")
          ? Deferred.succeed(ready, line.slice("Connection string: ".length))
          : Effect.void,
      ),
      Effect.forkScoped,
    );
    return yield* Effect.raceFirst(
      Deferred.await(ready),
      child.exitCode.pipe(
        Effect.flatMap((code) =>
          Effect.fail(new ProofFailure({ stage: `server exited before readiness (${code})` })),
        ),
      ),
    );
  });
  const originA = yield* launch(homeA, "proof");
  const originB = yield* launch(homeB, "native");
  yield* check(originA !== originB, "independent listeners");
  const token = yield* cli(["auth", "session", "issue", "--token-only"]);
  const headers = { authorization: `Bearer ${token}` };
  const response = (origin: string, authenticated: boolean) =>
    HttpClient.execute(
      HttpClientRequest.get(`${origin}/api/paperkite/runtime`).pipe(
        HttpClientRequest.setHeaders(authenticated ? headers : {}),
      ),
    );
  yield* check(
    (yield* response(originA, false)).status === 401,
    "runtime endpoint requires native authentication",
  );
  yield* check(
    (yield* response(originB, true)).status === 401,
    "instance A token rejected by instance B",
  );
  const nativeToken = yield* cli(["auth", "session", "issue", "--token-only"], homeB);
  const nativeStatus = yield* HttpClient.execute(
    HttpClientRequest.get(`${originB}/api/paperkite/runtime`).pipe(
      HttpClientRequest.setHeader("authorization", `Bearer ${nativeToken}`),
    ),
  ).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeStatus)),
  );
  yield* check(
    nativeStatus.profile === "native" &&
      nativeStatus.capabilities.threadSettlement &&
      !nativeStatus.capabilities.pullRequests,
    "native profile starts without PR services and retains settlement",
  );
  const status = yield* response(originA, true).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeStatus)),
  );
  yield* check(
    status.application === "paperkite" &&
      status.profile === "proof" &&
      !status.capabilities.threadSettlement &&
      !status.capabilities.pullRequests &&
      !status.capabilities.git,
    "owned runtime status",
  );
  const { ticket } = yield* HttpClient.execute(
    HttpClientRequest.post(`${originA}/api/auth/websocket-ticket`).pipe(
      HttpClientRequest.setHeaders(headers),
    ),
  ).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ ticket: Schema.String }))),
  );
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide(
        Socket.layerWebSocket(
          `${originA.replace(/^http/, "ws")}/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}&wsTicket=${encodeURIComponent(ticket)}`,
        ),
      ),
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(NodeWS.layerWebSocketConstructor),
    ),
  );
  const rpc = yield* RpcClient.make(WsRpcGroup).pipe(Effect.provideContext(protocol));
  const config = yield* rpc["server.getConfig"]({});
  yield* check(
    config.environment.capabilities.threadSettlement === false &&
      config.environment.capabilities.threadAutoSettlement === false &&
      config.environment.capabilities.git === false &&
      config.environment.capabilities.github === false &&
      config.environment.capabilities.sourceControl === false &&
      config.environment.capabilities.issues === false &&
      config.environment.capabilities.pairing === false &&
      config.environment.capabilities.additionalEnvironments === false &&
      config.environment.capabilities.peerLinks === false &&
      config.environment.capabilities.vcsBranchStatus === false &&
      config.environment.capabilities.pullRequests === false &&
      config.environment.capabilities.pullRequestChecks === false &&
      config.environment.capabilities.linkedThreadRefreshes === false &&
      config.environment.capabilities.threadPullRequests === false &&
      config.environment.capabilities.threadPullRequestWatch === false &&
      config.environment.capabilities.threadPullRequestLinking === false &&
      config.environment.capabilities.pullRequestStackActions === false,
    "native availability descriptor",
  );
  const unsupportedSettings = yield* rpc["server.updateSettings"]({
    patch: {
      sourceControlHosts: { github: { tokens: { "github.com": "fixture-retired-token" } } },
    },
  }).pipe(Effect.result);
  yield* check(
    unsupportedSettings._tag === "Failure" &&
      unsupportedSettings.failure._tag === "ServerSettingsError" &&
      unsupportedSettings.failure.operation === "normalize",
    "unsupported host credentials rejected before storage",
  );
  const publicSettings = yield* rpc["server.getSettings"]({});
  yield* check(
    !Object.hasOwn(publicSettings.sourceControlHosts, "github"),
    "unsupported host credentials absent from public settings",
  );
  yield* Console.log("Paperkite proof: unsupported host settings rejected");
  const api = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: originA });
  yield* check(
    typeof config.scratchWorkspaceRoot === "string",
    "No project stays available without a Git probe",
  );
  const workspace = path.join(parent, "workspace");
  yield* fs.makeDirectory(workspace);
  yield* fs.writeFileString(
    path.join(workspace, "README.md"),
    "Isolated Paperkite replay proof.\n",
  );
  yield* run("git", ["-C", workspace, "init", "--quiet", "--initial-branch=main"], homeA);
  const created = yield* api.projects.mutate({
    headers,
    payload: {
      type: "project.create",
      commandId: CommandId.make("paperkite-proof-project"),
      projectId: ProjectId.make("paperkite-proof-project"),
      title: "Paperkite proof",
      workspaceRoot: workspace,
    },
  });
  const pairingResponse = yield* HttpClient.execute(
    HttpClientRequest.post(`${originA}/api/auth/pairing-token`).pipe(
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyJsonUnsafe({}),
    ),
  );
  const pairingError = yield* pairingResponse.json;
  yield* check(
    pairingResponse.status === 503 && isPairingDisabled(pairingError),
    "device pairing unavailable without changing local authentication",
  );
  // Proof's separate managed policy already refuses Connect; exercise the product gate in native.
  const connectResponse = yield* HttpClient.execute(
    HttpClientRequest.post(`${originB}/api/t3-connect/mint-credential`).pipe(
      HttpClientRequest.bodyJsonUnsafe({ proof: "fixture" }),
    ),
  );
  const connectError = yield* connectResponse.json;
  yield* check(
    connectResponse.status === 503 && isPairingDisabled(connectError),
    `Connect pairing unavailable (HTTP ${connectResponse.status}, ${isTaggedError(connectError) ? connectError._tag : "unknown error"})`,
  );
  yield* Console.log("Paperkite proof: HTTP admission verified");
  const peerNames = yield* rpc["peerLinks.names"]({}).pipe(Effect.result);
  yield* check(
    peerNames._tag === "Failure" &&
      peerNames.failure._tag === "EnvironmentFeatureUnavailableError" &&
      peerNames.failure.feature === "environments",
    "direct peer RPC unavailable",
  );
  yield* Console.log("Paperkite proof: peer RPC admission verified");
  for (const tag of [
    "vcs.refreshStatus",
    "vcs.createWorktree",
    "vcs.removeWorktree",
    "git.runStackedAction",
    "sourceControl.signInStart",
    "sourceControl.publishRepository",
    "issues.detail",
    "issueTrackers.list",
    "issueTrackers.connect",
    "pullRequests.preview",
    "projectClone.start",
    "workspace.taskFolder",
    "server.discoverSourceControl",
    "server.prepareTriage",
    "orchestration.getTurnDiff",
  ])
    yield* check(!WsRpcGroup.requests.has(tag), `removed RPC absent: ${tag}`);
  yield* Console.log("Paperkite proof: Git/forge/issue methods absent from product contract");
  yield* run(
    path.join(root, "tooling/paperkite"),
    ["auth", "pairing", "create", "--json", "--base-dir", homeA],
    homeA,
    1,
  );
  yield* Console.log("Paperkite proof: CLI admission verified");
  const prRef = { projectId: created.id, repository: "fixture/fixture", number: 123 };
  const prHttp = yield* HttpClient.execute(
    HttpClientRequest.post(`${originA}/api/pull-requests/diff`).pipe(
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyJsonUnsafe(prRef),
    ),
  );
  const prHttpError = yield* prHttp.json;
  yield* check(
    prHttp.status === 503 && isProductDisabled(prHttpError),
    "direct PR HTTP request explicitly unavailable",
  );
  const started = yield* cli([
    "thread",
    "start",
    workspace,
    "Respond with exactly: first fixture turn complete",
    "--title",
    "Paperkite proof",
    "--provider",
    "devReplay",
    "--model",
    "multi-turn",
    "--wait",
    "--json",
  ]);
  const { threadId } = yield* decodeStartedThread(started);
  yield* cli([
    "thread",
    "send",
    threadId,
    "Respond with exactly: second fixture turn complete",
    "--wait",
    "--json",
  ]);
  const snapshot = () => rpc["orchestration.getThreadProjection"]({ threadId });
  const before = yield* snapshot();
  yield* check(
    before.thread.projectId === created.id &&
      before.messages.some(
        (message) =>
          message.role === "assistant" && message.text.includes("first fixture turn complete"),
      ),
    "native replay turn persisted",
  );
  yield* check(
    before.runs.length === 2 &&
      before.runs.every((run) => run.status === "completed") &&
      before.checkpoints.length > 0 &&
      before.checkpoints.every(
        (checkpoint) => checkpoint.status === "missing" && checkpoint.files.length === 0,
      ),
    "native replay completes without Git snapshots",
  );
  const refs = yield* run("git", ["-C", workspace, "for-each-ref", "refs/t3"], homeA);
  yield* check(refs.trim() === "", "chat creates no hidden Git refs");
  const denied = yield* rpc["orchestration.dispatchCommand"]({
    type: "thread.settle",
    commandId: CommandId.make("paperkite-proof-settle"),
    threadId,
  }).pipe(Effect.exit);
  yield* check(
    Exit.isFailure(denied) && Cause.pretty(denied.cause).includes("threadSettlement"),
    "direct RPC rejects unavailable capability",
  );
  const prLink = yield* rpc["orchestration.dispatchCommand"]({
    type: "thread.pull-request.link",
    commandId: CommandId.make("paperkite-proof-pr-link"),
    threadId,
    host: "github.com",
    repository: "fixture/fixture",
    number: 123,
    source: "manual",
    url: "https://github.com/fixture/fixture/pull/123",
  }).pipe(Effect.exit);
  yield* check(
    Exit.isFailure(prLink) && Cause.pretty(prLink.cause).includes("pullRequests"),
    "direct PR linking command unavailable",
  );
  const after = yield* snapshot();
  yield* check(
    after.thread.settledOverride === null &&
      DateTime.formatIso(before.thread.updatedAt) === DateTime.formatIso(after.thread.updatedAt),
    "rejected command leaves thread unchanged",
  );
  const sideId = ThreadId.make("paperkite-proof-side-chat");
  yield* rpc["orchestration.dispatchCommand"]({
    type: "thread.fork",
    commandId: CommandId.make("paperkite-proof-fork"),
    createdBy: "user",
    creationSource: "web",
    sourceThreadId: threadId,
    targetThreadId: sideId,
    sourcePoint: { type: "latest_stable" },
    sideChat: true,
  });
  const side = yield* rpc["orchestration.getThreadProjection"]({ threadId: sideId });
  yield* check(
    side.thread.lineage.sideChat === true && side.thread.lineage.parentThreadId === threadId,
    "native side-chat lineage",
  );
  yield* Console.log({
    isolatedInstances: 2,
    authenticationIsolation: true,
    nativeReplay: true,
    completedRunsWithoutSnapshots: before.runs.length,
    hiddenGitRefs: 0,
    gitApiAbsent: true,
    pairingRejected: true,
    additionalEnvironmentsRejected: true,
    settlementRejectedWithoutMutation: true,
    nativeSideChat: true,
  });
});

if (import.meta.main) {
  prove.pipe(
    Effect.timeoutOrElse({
      duration: "60 seconds",
      orElse: () => Effect.fail(new ProofFailure({ stage: "execution deadline" })),
    }),
    Effect.scoped,
    Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, FetchHttpClient.layer)),
    NodeRuntime.runMain,
  );
}
