import * as DocumentText from "../provider/DocumentText.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as ServerConfig from "../config.ts";
import { createPendingAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import * as ThreadMessageIntake from "./ThreadMessageIntake.ts";
import { assert, it, vi } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  ChatAttachmentId,
  ComposerContextId,
  type ChatAttachment,
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  MessageId,
  RunId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  OrchestrationV2ThreadProjectionJson,
  ScheduledTaskId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { ClaudeProviderCapabilitiesV2 } from "./Adapters/ClaudeAdapterV2.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ThreadTitleRegeneration from "./ThreadTitleRegenerationService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const layerForbiddenIds = Layer.succeed(IdAllocator.IdAllocatorV2, {
  get allocate(): never {
    throw new Error("ID allocation must not run before rejection");
  },
  get derive(): never {
    throw new Error("ID derivation must not run before rejection");
  },
});

const projectId = ProjectId.make("project:launch-test");
const otherProjectId = ProjectId.make("project:launch-other");
const encodeThreadProjection = Schema.encodeEffect(OrchestrationV2ThreadProjectionJson);
const dispatchIntakeCommand = (
  command: Parameters<typeof ThreadMessageIntake.dispatchCommand>[0],
) => ThreadMessageIntake.dispatchCommand(command, { managesProviders: true });
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.1-codex",
} as const;
const project = {
  id: projectId,
  title: "Project",
  workspaceRoot: "/repo",
  repositoryIdentity: null,
  faviconPath: null,
  defaultModelSelection: modelSelection,
  defaultThreadEnvMode: null,
  scripts: [],
  trackedFolders: [],
  pinnedAt: null,
  archivedAt: null,
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
  deletedAt: null,
} as const;

const otherProject = {
  ...project,
  id: otherProjectId,
  title: "Other",
  workspaceRoot: "/other-repo",
} as const;

const adapter = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("provider execution is disabled in launch tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const claudeModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-5-5",
} as const;
const claudeAdapter = {
  instanceId: claudeModelSelection.instanceId,
  driver: ProviderDriverKind.make("claudeAgent"),
  getCapabilities: () => Effect.succeed(ClaudeProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("provider execution is disabled in launch tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

interface HarnessOptions {
  readonly closeTerminal?: TerminalManager.TerminalManager["Service"]["close"];
  readonly adapters?: ReadonlyArray<ProviderAdapter.ProviderAdapterV2["Service"]>;
  readonly managedFolders?: Layer.Layer<ManagedProjectFolders.ManagedProjectFolders>;
  readonly scratch?: boolean;
  readonly runSetup?: ProjectSetupScriptRunner.ProjectSetupScriptRunner["Service"]["runForThread"];
  readonly generateTitle?: TextGeneration.TextGeneration["Service"]["generateThreadTitle"];
  readonly serverSettings?: Parameters<typeof ServerSettings.layerTest>[0];
  readonly providers?: ReadonlyArray<ServerProvider>;
  readonly dispatch?: (
    command: Parameters<ThreadManagement.ThreadManagementService["Service"]["dispatch"]>[0],
    dispatch: ThreadManagement.ThreadManagementService["Service"]["dispatch"],
  ) => ReturnType<ThreadManagement.ThreadManagementService["Service"]["dispatch"]>;
}

function makeHarness(options: HarnessOptions = {}) {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerRegistry = ProviderAdapterRegistry.layerFromAdapters(options.adapters ?? [adapter]);
  const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
    { name: "thread-launch" },
    layerRegistry,
    { databaseLayer: layerDatabase, runEffectWorker: false },
  );
  const layerServerSettings = ServerSettings.layerTest(options.serverSettings);
  const layerReceipts = CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase));
  const layerThreadManagement = ThreadManagement.layer.pipe(
    Layer.provide(layerOrchestrator),
    Layer.provide(layerServerSettings),
    Layer.provide(layerReceipts),
  );
  const layerOutbox = EffectOutbox.layer.pipe(Layer.provide(layerDatabase));
  const runSetup = vi.fn(
    options.runSetup ?? (() => Effect.succeed({ status: "no-script" as const })),
  );
  const closeTerminal = vi.fn(options.closeTerminal ?? (() => Effect.void));
  const generateThreadTitle = vi.fn(
    options.generateTitle ?? (() => Effect.succeed({ title: "Generated title" })),
  );
  const layerExternalServices = Layer.mergeAll(
    Layer.mock(TerminalManager.TerminalManager)({ close: closeTerminal }),
    Layer.succeed(ProjectService.ProjectService, {
      create: () => Effect.die("unused"),
      bootstrap: () => Effect.die("unused"),
      update: () => Effect.die("unused"),
      delete: () => Effect.die("unused"),
      listPage: () => Effect.die("unused"),
      getById: (id) =>
        Effect.succeed(
          id === projectId
            ? Option.some(project)
            : id === otherProjectId
              ? Option.some(otherProject)
              : Option.none(),
        ),
      getByWorkspaceRoot: () => Effect.succeedSome(project),
      workspaceScanDirectory: () => Effect.die("unused"),
      snapshot: Effect.die("unused"),
      getShell: () => Effect.die("unused"),
      listShells: () => Effect.die("unused"),
    }),
    Layer.succeed(ProjectSetupScriptRunner.ProjectSetupScriptRunner, {
      runForThread: runSetup,
    }),
    Layer.mock(TextGeneration.TextGeneration)({
      generateThreadTitle,
    }),
    layerServerSettings,
    ProviderRegistryMock.layer(options.providers),
    options.managedFolders ??
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: (id) => Effect.succeed(options.scratch === true && id === projectId),
        folderForThread: ({ threadId }) => Effect.succeedSome(`/scratch/${threadId}`),
      }),
  );
  const interceptDispatch = options.dispatch;
  const layerLaunchThreads =
    interceptDispatch === undefined
      ? layerThreadManagement
      : Layer.effect(
          ThreadManagement.ThreadManagementService,
          Effect.gen(function* () {
            const threads = yield* ThreadManagement.ThreadManagementService;
            return ThreadManagement.ThreadManagementService.of({
              ...threads,
              dispatch: (command) => interceptDispatch(command, threads.dispatch),
            });
          }),
        ).pipe(Layer.provide(layerThreadManagement));
  const layerLaunch = ThreadLaunch.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerExternalServices,
        layerLaunchThreads,
        layerReceipts,
        layerOrchestrator,
        IdAllocator.layer,
      ),
    ),
  );
  const layerProjectedProjects = Layer.mock(ProjectStore.ProjectStoreV2)({
    get: (requestedProjectId) =>
      Effect.succeed(
        requestedProjectId === projectId
          ? Option.some({
              projectId,
              title: project.title,
              workspaceRoot: project.workspaceRoot,
              defaultModelSelection: project.defaultModelSelection,
              defaultThreadEnvMode: null,
              hasCustomTitle: false,
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: project.scripts,
              trackedFolders: [],
              pinnedAt: null,
              archivedAt: null,
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
              deletedAt: project.deletedAt,
            })
          : Option.none(),
      ),
  });
  const layerTitleRegeneration = ThreadTitleRegeneration.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerThreadManagement,
        layerProjectedProjects,
        layerExternalServices,
        NodeServices.layer,
      ),
    ),
  );
  return {
    layer: Layer.mergeAll(
      layerLaunch,
      layerRegistry,
      layerThreadManagement,
      layerTitleRegeneration,
      layerOutbox,
      layerDatabase,
      layerExternalServices,
    ),
    generateThreadTitle,
    runSetup,
    closeTerminal,
  };
}

function launchInput(input: {
  readonly command: string;
  readonly thread: string;
  readonly message?: string;
  readonly workspace?: ThreadLaunch.ThreadLaunchWorkspaceStrategy;
}) {
  return {
    commandId: CommandId.make(input.command),
    threadId: ThreadId.make(input.thread),
    projectId,
    title: "New thread",
    modelSelection,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    workspaceStrategy: input.workspace ?? { type: "root" as const },
    ...(input.message === undefined
      ? {}
      : {
          initialMessage: {
            messageId: MessageId.make(`${input.message}:id`),
            text: input.message,
            attachments: [],
          },
        }),
    createdBy: "user" as const,
    creationSource: "web" as const,
  };
}

it.effect.each(
  (["new", "existing"] as const).flatMap((target) =>
    (["user", "agent"] as const).map((createdBy) => ({ target, createdBy })),
  ),
)(
  "attributes $createdBy-configured automations in $target threads without changing their prompt",
  ({ target, createdBy }) => {
    const harness = makeHarness();
    const layerScheduledTasks = ScheduledTasks.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          harness.layer,
          NodeCrypto.layer,
          Scheduler.layer,
          Layer.mock(SecretRequests.SecretRequests)({}),
          ManagedPolicy.layerTest(),
          Layer.mock(RemoteDelegation.RemoteDelegation)({}),
        ),
      ),
    );
    return Effect.gen(function* () {
      const tasks = yield* ScheduledTasks.ScheduledTaskService;
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const existing =
        target === "existing"
          ? yield* launches.launch(
              launchInput({ command: "command:existing", thread: "thread:existing" }),
            )
          : null;
      const { task } = yield* tasks.upsert({
        id: ScheduledTaskId.make("scheduled-task:attribution"),
        title: "Daily audit",
        prompt: "Audit performance and crashes.",
        enabled: false,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId,
        threadId: existing?.threadId ?? null,
        workspaceStrategy: { type: "root" },
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdBy,
        creationSource: createdBy === "agent" ? "mcp" : "web",
      });
      const result = yield* tasks.runNow({ id: task.id });
      assert.equal(result.task.lastRunStatus, "succeeded");
      const projectThreads = yield* threads.listProjectThreads({
        projectId,
        includeSubagents: false,
      });
      const thread =
        projectThreads.find((candidate) => candidate.id === existing?.threadId) ??
        projectThreads[0];
      assert.isDefined(thread);
      assert.equal(result.threadId, thread!.id);
      const projection = yield* threads.getThreadProjection(thread!.id);
      const wire = yield* encodeThreadProjection(projection);
      assert.equal(wire.messages[0]?.text, task.prompt);
      assert.equal(wire.messages[0]?.scheduledTaskId, task.id);
      assert.equal(wire.messages[0]?.createdBy, createdBy);
      const turnItem = wire.turnItems.find(
        (item): item is Extract<typeof item, { type: "user_message" }> =>
          item.type === "user_message",
      );
      assert.equal(turnItem?.text, task.prompt);
      assert.equal(turnItem?.scheduledTaskId, task.id);
    }).pipe(Effect.provide(Layer.mergeAll(harness.layer, layerScheduledTasks)));
  },
);

it.effect(
  "returns no dispatched thread when sending an automation to a missing thread fails",
  () => {
    const harness = makeHarness();
    const layerScheduledTasks = ScheduledTasks.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          harness.layer,
          NodeCrypto.layer,
          Scheduler.layer,
          Layer.mock(SecretRequests.SecretRequests)({}),
          ManagedPolicy.layerTest(),
        ),
      ),
    );
    return Effect.gen(function* () {
      const tasks = yield* ScheduledTasks.ScheduledTaskService;
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const { threadId } = yield* launches.launch(
        launchInput({ command: "command:missing", thread: "thread:missing" }),
      );
      const { task } = yield* tasks.upsert({
        title: "Daily audit",
        prompt: "Audit performance and crashes.",
        enabled: false,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId,
        threadId,
        workspaceStrategy: { type: "root" },
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdBy: "user",
        creationSource: "web",
      });
      yield* threads.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("command:missing:delete"),
        threadId,
      });
      const result = yield* tasks.runNow({ id: task.id });
      assert.equal(result.task.lastRunStatus, "failed");
      assert.isNull(result.threadId);
      assert.equal(result.task.threadId, threadId);
    }).pipe(Effect.provide(Layer.mergeAll(harness.layer, layerScheduledTasks)));
  },
);

it.effect("leaves delegated tasks and workflow agent steps out of the top-level list", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    yield* launches.launch(
      launchInput({ command: "command:top-level", thread: "thread:top-level" }),
    );
    const delegated = yield* launches.launch({
      ...launchInput({ command: "command:delegated", thread: "thread:delegated" }),
      createdBy: "agent",
      creationSource: "mcp",
      linkOrigin: { sessionId: "mcp-session:linked", label: "Linked laptop" },
      delegatedFrom: {
        environmentId: EnvironmentId.make("environment:linked"),
        threadId: ThreadId.make("thread:remote-parent"),
        title: "Remote parent",
      },
    });
    const workflowStep = yield* launches.launch({
      ...launchInput({ command: "command:workflow-step", thread: "thread:workflow-step" }),
      createdBy: "system",
      creationSource: "server",
      workflowRun: {
        environmentId: EnvironmentId.make("environment:local"),
        runId: "run:1",
        workflow: "review",
        step: "agent",
      },
    });
    const listed = yield* threads.listProjectThreads({ projectId, includeSubagents: false });
    assert.deepEqual(
      listed.map((thread) => thread.id),
      [ThreadId.make("thread:top-level")],
    );
    const all = yield* threads.listProjectThreads({ projectId, includeSubagents: true });
    assert.includeMembers(
      all.map((thread) => thread.id),
      [delegated.threadId, workflowStep.threadId],
    );
  }).pipe(Effect.provide(harness.layer));
});

it.effect("runs a thread-bound automation on the provider the thread uses now", () => {
  const harness = makeHarness({ adapters: [adapter, claudeAdapter] });
  const layerScheduledTasks = ScheduledTasks.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        harness.layer,
        NodeCrypto.layer,
        Scheduler.layer,
        Layer.mock(SecretRequests.SecretRequests)({}),
        ManagedPolicy.layerTest(),
      ),
    ),
  );
  return Effect.gen(function* () {
    const tasks = yield* ScheduledTasks.ScheduledTaskService;
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const launched = yield* launches.launch(
      launchInput({ command: "command:switched", thread: "thread:switched" }),
    );
    const { task } = yield* tasks.upsert({
      id: ScheduledTaskId.make("scheduled-task:switched"),
      title: "Hourly check",
      prompt: "Check on the delegated workers.",
      enabled: false,
      schedule: { type: "interval", everyMs: 3_600_000 },
      projectId,
      threadId: launched.threadId,
      workspaceStrategy: { type: "root" },
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      createdBy: "agent",
      creationSource: "mcp",
    });
    yield* threads.dispatch({
      type: "thread.model-selection.set",
      commandId: CommandId.make("command:switch-selection"),
      threadId: launched.threadId,
      modelSelection: claudeModelSelection,
    });

    const result = yield* tasks.runNow({ id: task.id });
    assert.equal(result.task.lastRunStatus, "succeeded");
    const projection = yield* threads.getThreadProjection(launched.threadId);
    const message = projection.messages.find((item) => item.scheduledTaskId === task.id);
    const run = projection.runs.find((item) => item.id === message?.runId);
    assert.deepStrictEqual(run?.modelSelection, claudeModelSelection);
    assert.deepStrictEqual(projection.thread.modelSelection, claudeModelSelection);
  }).pipe(Effect.provide(Layer.mergeAll(harness.layer, layerScheduledTasks)));
});

it.effect("retains automation and sender attribution while a message waits in the queue", () => {
  const harness = makeHarness({
    scratch: true,
    runSetup: () => Effect.never,
  });
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const launched = yield* launches.launch(
      launchInput({
        command: "command:automation:queue",
        thread: "thread:automation:queue",
        message: "First message",
        workspace: { type: "root" },
      }),
    );
    const scheduledTaskId = ScheduledTaskId.make("scheduled-task:queued");
    const senderThreadId = ThreadId.make("thread:agent-sender");
    const queued = yield* threads.sendToThread({
      projectId,
      commandId: CommandId.make("command:automation:queued"),
      threadId: launched.threadId,
      messageId: MessageId.make("message:automation:queued"),
      scheduledTaskId,
      senderThreadId,
      text: "Run the audit",
      attachments: [],
      mode: "queue",
      createdBy: "agent",
      creationSource: "mcp",
    });
    assert.equal(queued.delivery, "queued");
    const projection = yield* threads.getThreadProjection(launched.threadId);
    const message = projection.messages.find((item) => item.id === queued.message.id);
    assert.equal(message?.scheduledTaskId, scheduledTaskId);
    assert.equal(message?.senderThreadId, senderThreadId);
    assert.equal(message?.text, "Run the audit");
    // A fresh send queues instead of steering, so it needs no steerable run.
    const fresh = yield* threads.sendToThread({
      projectId,
      commandId: CommandId.make("command:automation:queued-fresh"),
      threadId: launched.threadId,
      messageId: MessageId.make("message:automation:queued-fresh"),
      text: "Start over",
      attachments: [],
      mode: "steer",
      freshContext: true,
      createdBy: "agent",
      creationSource: "mcp",
    });
    assert.equal(fresh.delivery, "queued");
    assert.isTrue(fresh.run.freshContext);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("a run asked for a result stores what its agent submits once it fits the schema", () => {
  const harness = makeHarness({
    scratch: true,
    runSetup: () => Effect.never,
  });
  const outputSchema = {
    type: "object",
    properties: { verdict: { enum: ["merge", "fix-first"] } },
    required: ["verdict"],
  };
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const input = launchInput({
      command: "command:output:launch",
      thread: "thread:output",
      message: "Review it",
      workspace: { type: "root" },
    });
    const launched = yield* launches.launch({
      ...input,
      initialMessage: { ...input.initialMessage!, outputSchema },
    });
    const submit = (command: string, json: string) =>
      threads.submitRunOutput({
        threadId: launched.threadId,
        commandId: CommandId.make(command),
        json,
      });

    const rejected = yield* submit("command:output:bad", '{"verdict":"maybe"}').pipe(Effect.flip);
    assert.equal(rejected._tag, "ThreadManagementRunOutputRejectedError");
    // What did not fit is kept as the cause, for the agent that wrote it and nobody's logs.
    assert.equal(rejected.message, "The result does not match the schema.");
    assert.include(
      String((rejected as { cause?: { message?: string } }).cause?.message),
      "verdict",
    );
    const unparsed = yield* submit("command:output:text", "merge").pipe(Effect.flip);
    assert.include(unparsed.message, "not valid JSON");

    const accepted = yield* submit("command:output:good", '{"verdict":"merge","note":"kept"}');
    const stored = (yield* threads.getThreadProjection(launched.threadId)).runs.find(
      (run) => run.id === accepted.runId,
    );
    assert.deepStrictEqual(stored?.outputSchema, outputSchema);
    // Kept as submitted, including what the schema does not name.
    assert.deepStrictEqual(stored?.output?.value, { verdict: "merge", note: "kept" });

    // Asking for a result never joins the running turn, and a plain turn has nothing to submit to.
    const next = yield* threads.sendToThread({
      projectId,
      commandId: CommandId.make("command:output:next"),
      threadId: launched.threadId,
      messageId: MessageId.make("message:output:next"),
      text: "Review it again",
      attachments: [],
      mode: "steer",
      outputSchema,
      createdBy: "agent",
      creationSource: "mcp",
    });
    assert.equal(next.delivery, "queued");
    assert.deepStrictEqual(next.run.outputSchema, outputSchema);
    assert.isUndefined(next.run.output);
    const unusable = yield* threads
      .sendToThread({
        projectId,
        commandId: CommandId.make("command:output:unusable"),
        threadId: launched.threadId,
        messageId: MessageId.make("message:output:unusable"),
        text: "Review it again",
        attachments: [],
        mode: "queue",
        outputSchema: { $ref: "#/$defs/Missing" },
        createdBy: "agent",
        creationSource: "mcp",
      })
      .pipe(Effect.result);
    assert.isTrue(Result.isFailure(unusable));
  }).pipe(Effect.provide(harness.layer));
});

it.effect("a run that was not asked for a result rejects a submission", () => {
  const harness = makeHarness({
    scratch: true,
    runSetup: () => Effect.never,
  });
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const launched = yield* launches.launch(
      launchInput({
        command: "command:no-output:launch",
        thread: "thread:no-output",
        message: "Just talk",
        workspace: { type: "root" },
      }),
    );
    const rejected = yield* threads
      .submitRunOutput({
        threadId: launched.threadId,
        commandId: CommandId.make("command:no-output:submit"),
        json: "{}",
      })
      .pipe(Effect.flip);
    assert.include(rejected.message, "not asked for a result");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("provisions independent launches concurrently instead of behind a global semaphore", () =>
  Effect.gen(function* () {
    const setupCount = yield* Ref.make(0);
    const bothEntered = yield* Deferred.make<void>();
    const allowSetup = yield* Deferred.make<void>();
    const harness = makeHarness({
      scratch: true,
      runSetup: () =>
        Ref.updateAndGet(setupCount, (count) => count + 1).pipe(
          Effect.tap((count) =>
            count === 2 ? Deferred.succeed(bothEntered, undefined) : Effect.void,
          ),
          Effect.andThen(Deferred.await(allowSetup)),
          Effect.as({ status: "no-script" as const }),
        ),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const results = yield* Effect.all(
        [
          launches.launch(
            launchInput({
              command: "command:launch:concurrent-a",
              thread: "thread:launch:concurrent-a",
              message: "First",
              workspace: { type: "root" },
            }),
          ),
          launches.launch(
            launchInput({
              command: "command:launch:concurrent-b",
              thread: "thread:launch:concurrent-b",
              message: "Second",
              workspace: { type: "root" },
            }),
          ),
        ],
        { concurrency: "unbounded" },
      );
      assert.deepEqual(
        results.map((result) => result.projection.runs[0]?.status),
        ["preparing", "preparing"],
      );
      yield* Deferred.await(bothEntered);
      assert.equal(yield* Ref.get(setupCount), 2);
      yield* Deferred.succeed(allowSetup, undefined);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect.each([" /COMPACT "])(
  "uses the first conversation message for a title after %s",
  (nativeCommand) =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.gen(function* () {
        const launches = yield* ThreadLaunch.ThreadLaunchService;
        const threads = yield* ThreadManagement.ThreadManagementService;
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        const launched = yield* launches.launch({
          ...launchInput({
            command: "compact-title",
            thread: "compact-title-thread",
            message: nativeCommand,
          }),
          generateTitle: true,
        });
        assert.isUndefined(
          (yield* threads.getThreadProjection(launched.threadId)).thread.titleRegeneration,
        );
        assert.isNull((yield* threads.getThreadProjection(launched.threadId)).thread.lastVisitedAt);
        assert.isFalse(
          (yield* outbox.listByCommandId(CommandId.make("compact-title"))).some(
            (effect) => effect.request.type === "thread-title.generate",
          ),
        );
        const commandId = CommandId.make("compact-title-conversation");
        const messageId = MessageId.make("compact-title-conversation-message");
        yield* threads.dispatch({
          type: "message.dispatch",
          commandId,
          threadId: launched.threadId,
          messageId,
          createdBy: "user",
          creationSource: "web",
          text: "Fix the failing parser",
          attachments: [],
          dispatchMode: { type: "defer_start" },
        });
        assert.equal(
          (yield* threads.getThreadProjection(launched.threadId)).thread.titleRegeneration
            ?.requestId,
          commandId,
        );
        assert.deepEqual(
          (yield* outbox.listByCommandId(commandId))
            .filter((effect) => effect.request.type === "thread-title.generate")
            .map((effect) => effect.request),
          [{ type: "thread-title.generate", kind: { type: "initial", messageId } }],
        );
      }).pipe(Effect.provide(harness.layer));
    }),
);

it.effect("keeps native maintenance commands out of steering and restart messages", () =>
  Effect.gen(function* () {
    const harness = makeHarness();
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      for (const scenario of [
        {
          name: "compact-steer",
          first: "Fix the parser",
          next: " /COMPACT ",
          mode: "steer_active",
        },
        {
          name: "compact-restart",
          first: "Fix the parser",
          next: "/compact",
          mode: "restart_active",
        },
        {
          name: "logout-steer",
          first: "Fix the parser",
          next: "/logout",
          mode: "steer_active",
        },
        {
          name: "logout-restart",
          first: "Fix the parser",
          next: "/logout",
          mode: "restart_active",
        },
        {
          name: "steer-logout",
          first: "/logout",
          next: "Continue with the parser",
          mode: "steer_active",
        },
        {
          name: "steer-compaction",
          first: "/compact",
          next: "Continue with the parser",
          mode: "steer_active",
        },
      ] as const) {
        const launched = yield* launches.launch(
          launchInput({
            command: `${scenario.name}:launch`,
            thread: scenario.name,
            message: scenario.first,
          }),
        );
        const before = yield* threads.getThreadProjection(launched.threadId);
        const targetRun = before.runs[0];
        if (targetRun === undefined) return yield* Effect.die("Launch must create a run");
        const commandId = CommandId.make(`${scenario.name}:message`);
        const dispatch = threads.dispatch({
          type: "message.dispatch",
          commandId,
          threadId: launched.threadId,
          messageId: MessageId.make(`${scenario.name}:message`),
          createdBy: "user",
          creationSource: "web",
          text: scenario.next,
          attachments: [],
          dispatchMode: { type: scenario.mode, targetRunId: targetRun.id },
        });
        if (scenario.mode === "steer_active") {
          yield* dispatch;
          const queued = (yield* threads.getThreadProjection(launched.threadId)).runs[1];
          assert.equal(queued?.status, "queued");
          assert.equal(queued?.userMessageId, MessageId.make(`${scenario.name}:message`));
          continue;
        }
        const failure = yield* dispatch.pipe(Effect.flip);
        assert.include(
          String(failure.cause).toLowerCase(),
          scenario.name.includes("logout") ? "sign" : "context compaction",
        );
        const after = yield* threads.getThreadProjection(launched.threadId);
        assert.deepEqual(after.messages, before.messages);
        assert.deepEqual(after.thread.titleRegeneration, before.thread.titleRegeneration);
        assert.deepEqual(yield* outbox.listByCommandId(commandId), []);
      }
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("arms durable title generation after accepting the first message", () =>
  Effect.gen(function* () {
    const harness = makeHarness({
      generateTitle: (input) =>
        Effect.succeed({
          title: input.previousTitle === undefined ? "Generated title" : "Regenerated title",
        }),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const titleRegeneration = yield* ThreadTitleRegeneration.ThreadTitleRegenerationService;
      const input = {
        ...launchInput({
          command: "command:launch:title-generation",
          thread: "thread:launch:title-generation",
          message: "Generate my title",
        }),
        title: "Generate my title",
        generateTitle: true,
      };
      const launched = yield* launches.launch(input);
      const generationCommandId = input.commandId;

      const projection = yield* threads.getThreadProjection(launched.threadId);
      assert.equal(projection.thread.title, "Generate my title");
      assert.equal(projection.thread.titleRegeneration?.requestId, generationCommandId);
      assert.deepEqual(
        (yield* outbox.listByCommandId(generationCommandId)).map((effect) => effect.request),
        [
          {
            type: "thread-title.generate",
            kind: { type: "initial", messageId: MessageId.make("Generate my title:id") },
          },
        ],
      );
      yield* titleRegeneration.execute({
        threadId: launched.threadId,
        requestId: generationCommandId,
        kind: { type: "initial", messageId: MessageId.make("Generate my title:id") },
      });
      const generated = yield* threads.getThreadProjection(launched.threadId);
      assert.equal(generated.thread.title, "Generated title");
      assert.deepEqual(
        harness.generateThreadTitle.mock.calls[0]?.[0]?.modelSelection,
        DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
      );

      const manualRequestId = CommandId.make("command:title-generation:manual");
      yield* threads.dispatch({
        type: "thread.metadata.update",
        commandId: manualRequestId,
        threadId: launched.threadId,
        regenerateTitle: true,
      });
      assert.deepEqual(
        (yield* outbox.listByCommandId(manualRequestId)).map((effect) => effect.request),
        [{ type: "thread-title.generate", kind: { type: "regenerate" } }],
      );
      yield* titleRegeneration.execute({
        threadId: launched.threadId,
        requestId: manualRequestId,
        kind: { type: "regenerate" },
      });
      const regenerated = yield* threads.getThreadProjection(launched.threadId);
      assert.equal(regenerated.thread.title, "Regenerated title");
      assert.equal(
        harness.generateThreadTitle.mock.calls[1]?.[0]?.previousTitle,
        "Generated title",
      );

      yield* threads.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("command:title-generation:user-rename"),
        threadId: launched.threadId,
        title: "Keep my title",
      });
      const renamed = yield* threads.getThreadProjection(launched.threadId);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* threads.dispatch({
        type: "thread.title.regeneration.complete",
        commandId: CommandId.make("command:title-generation:stale-completion"),
        threadId: launched.threadId,
        requestId: generationCommandId,
        title: "Stale generated title",
      });
      const afterStaleCompletion = yield* threads.getThreadProjection(launched.threadId);
      assert.equal(afterStaleCompletion.thread.title, "Keep my title");
      assert.equal(
        DateTime.toEpochMillis(afterStaleCompletion.thread.updatedAt),
        DateTime.toEpochMillis(renamed.thread.updatedAt),
      );
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("a rejected initial message leaves no title change and no new thread", () =>
  Effect.gen(function* () {
    const harness = makeHarness({ adapters: [adapter, claudeAdapter] });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const threadId = ThreadId.make("thread:launch:reused-title-failure");
      yield* threads.dispatch({
        type: "thread.create",
        commandId: CommandId.make("command:launch:reused-title-failure:create"),
        threadId,
        projectId,
        title: "Original title",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });

      const commandId = CommandId.make("command:launch:reused-title-failure");
      const failed = yield* launches
        .launch({
          ...launchInput({
            command: commandId,
            thread: threadId,
            message: "Generate a provisional title",
          }),
          reuseExistingThread: true,
          title: "Generate a provisional title",
          generateTitle: true,
          modelSelection: {
            instanceId: ProviderInstanceId.make("missing-provider"),
            model: "missing-model",
          },
        })
        .pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(failed));
      const projection = yield* threads.getThreadProjection(threadId);
      assert.equal(projection.thread.title, "Original title");
      assert.isUndefined(projection.thread.titleRegeneration);
      assert.isEmpty(projection.messages);
      assert.isEmpty(yield* outbox.listByCommandId(CommandId.make(`${commandId}:initial-message`)));

      // The orchestrator refuses this goal command, after the launch's own checks pass.
      const newThreadId = ThreadId.make("thread:launch:rejected-new-thread");
      const rejected = yield* launches
        .launch({
          ...launchInput({
            command: "command:launch:rejected-new-thread",
            thread: newThreadId,
            message: "/goal pause",
          }),
          modelSelection: claudeModelSelection,
        })
        .pipe(Effect.flip);
      if (rejected._tag !== "ThreadLaunchError") {
        assert.fail(`expected ThreadLaunchError, got ${rejected._tag}`);
      }
      assert.equal(rejected.operation, "create-thread");
      assert.isNull(yield* threads.getThreadShell(newThreadId));
    }).pipe(Effect.provide(harness.layer));
  }),
);

const preparationSettled = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    yield* threads.streamStoredEventsFrom({ threadId }).pipe(
      Stream.filter(
        (stored) =>
          stored.event.type === "run.updated" &&
          (stored.commandId?.endsWith(":release") === true ||
            stored.event.payload.status === "failed"),
      ),
      Stream.runHead,
    );
    return yield* threads.getThreadProjection(threadId);
  });

it.effect.each([false, true])("launches a plain folder without Git (Scratch=%s)", (scratch) => {
  const harness = makeHarness({ scratch });
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const launched = yield* launches.launch(
      launchInput({
        command: "command:launch:folder",
        thread: "thread:launch:folder",
        message: "Use this folder",
      }),
    );
    const projection = yield* preparationSettled(launched.threadId);
    const folder = scratch ? "/scratch/thread:launch:folder" : null;
    assert.equal(projection.thread.branch, null);
    assert.equal(projection.thread.worktreePath, folder);
    assert.equal(projection.runs[0]?.status, "starting");
    assert.equal(harness.runSetup.mock.calls.length, scratch ? 1 : 0);
    if (scratch) {
      assert.deepEqual(projection.runs[0]?.workspacePreparation, { type: "root" });
      assert.equal(harness.runSetup.mock.calls[0]?.[0]?.worktreePath, folder);
    }
  }).pipe(Effect.provide(harness.layer));
});

it.effect.each([
  { type: "worktree", baseRef: "main", startFromOrigin: true },
  { type: "worktree", baseRef: ":/initial", branch: "feature" },
  { type: "existing_worktree", worktreePath: "/existing-folder" },
  { type: "root", branch: "main" },
] satisfies ReadonlyArray<ThreadLaunch.ThreadLaunchWorkspaceStrategy>)(
  "rejects Git workspace $type before project lookup, ID allocation or mutation",
  (workspaceStrategy) =>
    Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const checkError = yield* launches
        .checkWorktreeBase({ projectId, workspaceStrategy })
        .pipe(Effect.flip);
      assert.equal(checkError._tag, "TaskFolderError");
      const { threadId: _unused, ...input } = launchInput({
        command: "command:launch:forbidden",
        thread: "unused",
        message: "Must not persist",
        workspace: workspaceStrategy,
      });
      const error = yield* launches.launch(input).pipe(Effect.flip);
      assert.equal(error._tag, "ThreadLaunchError");
      if (error._tag === "ThreadLaunchError") assert.equal(error.operation, "resolve-project");
    }).pipe(
      Effect.provide(
        ThreadLaunch.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProjectService.ProjectService)({}),
              Layer.mock(TerminalManager.TerminalManager)({}),
              Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
              Layer.mock(CommandReceiptStore.CommandReceiptStoreV2)({}),
              layerForbiddenIds,
              Layer.mock(ThreadManagement.ThreadManagementService)({}),
              Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
                namedProjectsRoot: "/forbidden",
              }),
            ),
          ),
        ),
      ),
    ),
);

it.effect("rejects a preparation retry after the project disables its provider", () => {
  let setupAttempts = 0;
  const harness = makeHarness({
    scratch: true,
    runSetup: () =>
      setupAttempts++ === 0
        ? Effect.fail(
            new ProjectSetupScriptRunner.ProjectSetupScriptUnsupportedShellError({
              shell: "cmd.exe",
            }),
          )
        : Effect.succeed({ status: "no-script" as const }),
  });
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const settings = yield* ServerSettings.ServerSettingsService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const launched = yield* launches.launch(
      launchInput({
        command: "command:launch:disabled-preparation-retry",
        thread: "thread:launch:disabled-preparation-retry",
        message: "Start from origin",
        workspace: { type: "root" },
      }),
    );
    yield* preparationSettled(launched.threadId);
    yield* settings.updateSettings({
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [modelSelection.instanceId]: { enabled: false } } },
      },
    });

    const error = yield* launches
      .retryPreparation({
        commandId: CommandId.make("command:launch:disabled-preparation-retry:retry"),
        threadId: launched.threadId,
        runId: launched.projection.runs[0]!.id,
      })
      .pipe(Effect.flip);

    assert.equal(error._tag, "ThreadManagementProviderInstanceDisabledError");
    assert.equal((yield* threads.getThreadProjection(launched.threadId)).runs[0]?.status, "failed");
    assert.equal(setupAttempts, 1);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("does not release a prepared run after the project disables its provider", () => {
  return Effect.gen(function* () {
    const setupEntered = yield* Deferred.make<void>();
    const allowSetup = yield* Deferred.make<void>();
    const harness = makeHarness({
      scratch: true,
      runSetup: () =>
        Deferred.succeed(setupEntered, undefined).pipe(
          Effect.andThen(Deferred.await(allowSetup)),
          Effect.as({ status: "no-script" as const }),
        ),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const settings = yield* ServerSettings.ServerSettingsService;
      const launched = yield* launches.launch(
        launchInput({
          command: "command:launch:disable-during-preparation",
          thread: "thread:launch:disable-during-preparation",
          message: "Prepare my Scratch folder",
          workspace: { type: "root" },
        }),
      );
      yield* Deferred.await(setupEntered);
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectId]: { providerInstances: { [modelSelection.instanceId]: { enabled: false } } },
        },
      });
      yield* Deferred.succeed(allowSetup, undefined);
      const projection = yield* preparationSettled(launched.threadId);
      assert.equal(projection.runs[0]?.status, "failed");
      const effects = yield* (yield* EffectOutbox.EffectOutboxV2).listByCommandId(
        CommandId.make("command:launch:disable-during-preparation:release"),
      );
      assert.isFalse(
        effects.some(
          (effect) =>
            effect.request.type === "provider-turn.start" &&
            effect.request.runId === launched.projection.runs[0]?.id,
        ),
      );
    }).pipe(Effect.provide(harness.layer));
  });
});

it.effect.each(["succeeds", "fails", "is interrupted"] as const)(
  "keeps a follow-up queued while Scratch setup %s",
  (ending) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const allowSetup = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      let attempts = 0;
      const harness = makeHarness({
        scratch: true,
        runSetup: () =>
          Effect.gen(function* () {
            attempts++;
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(allowSetup);
            if (ending === "fails" && attempts === 1)
              return yield* new ProjectSetupScriptRunner.ProjectSetupScriptUnsupportedShellError({
                shell: "cmd.exe",
              });
            return { status: "no-script" as const };
          }).pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
      });
      yield* Effect.gen(function* () {
        const launches = yield* ThreadLaunch.ThreadLaunchService;
        const threads = yield* ThreadManagement.ThreadManagementService;
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        const commandId = CommandId.make("launch:scratch-queued");
        const launched = yield* launches.launch(
          launchInput({
            command: commandId,
            thread: "thread:scratch-queued",
            message: "First message",
          }),
        );
        const runId = launched.projection.runs[0]!.id;
        yield* Deferred.await(entered);
        const followUp = yield* threads.sendToThread({
          projectId,
          commandId: CommandId.make("launch:scratch-queued:follow-up"),
          threadId: launched.threadId,
          messageId: MessageId.make("message:scratch-follow-up"),
          text: "Sent during setup",
          attachments: [],
          mode: "queue",
          createdBy: "user",
          creationSource: "web",
        });
        assert.equal(followUp.delivery, "queued");
        const duringSetup = yield* threads.getThreadProjection(launched.threadId);
        assert.equal(duringSetup.runs[0]?.status, "preparing");
        assert.equal(duringSetup.runs[1]?.status, "queued");
        assert.isEmpty(yield* outbox.listByCommandId(CommandId.make(`${commandId}:release`)));

        if (ending === "is interrupted") {
          yield* threads.dispatch({
            type: "run.interrupt",
            commandId: CommandId.make("launch:scratch-queued:interrupt"),
            threadId: launched.threadId,
            runId,
          });
          yield* Deferred.await(interrupted);
        } else {
          yield* Deferred.succeed(allowSetup, undefined);
          yield* preparationSettled(launched.threadId);
        }
        const projection = yield* threads.getThreadProjection(launched.threadId);
        assert.equal(
          projection.runs[0]?.status,
          ending === "succeeds" ? "starting" : ending === "fails" ? "failed" : "interrupted",
        );
        assert.equal(projection.thread.worktreePath, "/scratch/thread:scratch-queued");
        assert.equal(projection.messages.length, 2);
        if (ending !== "succeeds")
          assert.isEmpty(yield* outbox.listByCommandId(CommandId.make(`${commandId}:release`)));
      }).pipe(Effect.provide(harness.layer));
    }),
);

it.effect("retries failed Scratch setup without duplicating its message, run or folder", () => {
  let attempts = 0;
  const harness = makeHarness({
    scratch: true,
    runSetup: () =>
      ++attempts === 1
        ? Effect.fail(
            new ProjectSetupScriptRunner.ProjectSetupScriptUnsupportedShellError({
              shell: "cmd.exe",
            }),
          )
        : Effect.succeed({ status: "no-script" as const }),
  });
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const launched = yield* launches.launch(
      launchInput({
        command: "launch:scratch-retry",
        thread: "thread:scratch-retry",
        message: "Only once",
      }),
    );
    const failed = yield* preparationSettled(launched.threadId);
    assert.equal(failed.runs[0]?.status, "failed");
    const retryId = CommandId.make("launch:scratch-retry:retry");
    yield* launches.retryPreparation({
      commandId: retryId,
      threadId: launched.threadId,
      runId: failed.runs[0]!.id,
    });
    yield* threads.streamStoredEventsFrom({ threadId: launched.threadId }).pipe(
      Stream.filter(
        (stored) =>
          stored.commandId === `${retryId}:release` && stored.event.type === "run.updated",
      ),
      Stream.runHead,
    );
    const retried = yield* threads.getThreadProjection(launched.threadId);
    assert.equal(retried.runs.length, 1);
    assert.equal(retried.runs[0]?.status, "starting");
    assert.equal(retried.runs[0]?.id, failed.runs[0]?.id);
    assert.equal(retried.messages.length, 1);
    assert.equal(retried.messages[0]?.id, failed.messages[0]?.id);
    assert.equal(retried.thread.worktreePath, failed.thread.worktreePath);
    assert.equal(attempts, 2);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("returns from prepareRun without retrying a scheduling failure", () =>
  Effect.gen(function* () {
    const rejected = yield* Deferred.make<void>();
    let rejectedWrites = 0;
    const harness = makeHarness({
      dispatch: (command, dispatch) =>
        command.type !== "prepared-run.fail"
          ? dispatch(command)
          : Effect.suspend(() => {
              rejectedWrites += 1;
              return Deferred.succeed(rejected, undefined).pipe(
                Effect.andThen(Effect.die("SQLITE_FULL: database or disk is full")),
              );
            }),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      yield* launches.prepareRun({
        commandId: CommandId.make("command:prepare:missing-thread"),
        threadId: ThreadId.make("thread:prepare:missing-thread"),
        runId: RunId.make("run:prepare:missing-thread"),
      });
      yield* Deferred.await(rejected);
      yield* TestClock.adjust("1 second");
      assert.equal(rejectedWrites, 1);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("fails a run whose preparation failure could not be stored until storage recovers", () =>
  Effect.gen(function* () {
    const storageFull = yield* Deferred.make<void>();
    let rejectedWrites = 0;
    let preparations = 0;
    const harness = makeHarness({
      scratch: true,
      runSetup: () =>
        Effect.sync(() => preparations++).pipe(
          Effect.andThen(
            Effect.fail(
              new ProjectSetupScriptRunner.ProjectSetupScriptUnsupportedShellError({
                shell: "cmd.exe",
              }),
            ),
          ),
        ),
      dispatch: (command, dispatch) =>
        command.type !== "prepared-run.fail"
          ? dispatch(command)
          : Effect.suspend(() => {
              if (rejectedWrites >= 2) return dispatch(command);
              rejectedWrites += 1;
              return Deferred.succeed(storageFull, undefined).pipe(
                Effect.andThen(
                  Effect.fail(
                    new Orchestrator.OrchestratorDispatchError({
                      commandId: command.commandId,
                      commandType: command.type,
                      cause: new Error("SQLITE_FULL: database or disk is full"),
                    }),
                  ),
                ),
              );
            }),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const input = launchInput({
        command: "command:launch:storage-full",
        thread: "thread:launch:storage-full",
        message: "First message",
        workspace: { type: "root" },
      });
      const launched = yield* launches.launch(input);
      yield* Deferred.await(storageFull);
      yield* TestClock.adjust("0 seconds");
      yield* launches.launch(input);
      yield* TestClock.adjust("0 seconds");
      assert.equal(preparations, 1);
      yield* TestClock.adjust("1 second");
      yield* threads.streamStoredEventsFrom({ threadId: launched.threadId }).pipe(
        Stream.filter(
          (stored) =>
            stored.event.type === "run.updated" && stored.event.payload.status === "failed",
        ),
        Stream.runHead,
      );
      assert.equal(rejectedWrites, 2);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("replays a server-allocated launch", () =>
  Effect.gen(function* () {
    const setupEntered = yield* Deferred.make<void>();
    const allowSetup = yield* Deferred.make<void>();
    const harness = makeHarness({
      scratch: true,
      runSetup: () =>
        Deferred.succeed(setupEntered, undefined).pipe(
          Effect.andThen(Deferred.await(allowSetup)),
          Effect.as({ status: "no-script" as const }),
        ),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const { threadId: _unusedThreadId, ...rest } = launchInput({
        command: "command:launch:allocated-retry",
        thread: "unused",
        message: "Only once",
        workspace: { type: "root" },
      });
      const first = yield* launches.launch(rest);
      // One commit holds the thread and its first run, so no client sees the thread idle between.
      const launchCommits = yield* threads
        .streamStoredEventsFrom({ threadId: first.threadId })
        .pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "thread.created" || stored.event.type === "run.created",
          ),
          Stream.take(2),
          Stream.runCollect,
        );
      assert.deepEqual(
        Array.from(launchCommits, (stored) => stored.commandId),
        [rest.commandId, rest.commandId],
      );
      yield* Deferred.await(setupEntered);
      const retry = yield* launches.launch(rest);
      assert.equal(first.threadId, retry.threadId);
      assert.isFalse(first.resumed);
      assert.isTrue(retry.resumed);
      // Clients drop their pending copy once the thread reaches the message's commit.
      assert.isNumber(first.sequence);
      assert.equal(retry.sequence, first.sequence);
      assert.equal(harness.runSetup.mock.calls.length, 1);
      assert.equal(retry.projection.messages.length, 1);
      assert.equal(retry.projection.runs.length, 1);
      assert.equal(retry.projection.messages[0]?.id, first.projection.messages[0]?.id);
      assert.equal(retry.projection.runs[0]?.id, first.projection.runs[0]?.id);
      yield* Deferred.succeed(allowSetup, undefined);
      yield* threads.streamStoredEventsFrom({ threadId: first.threadId }).pipe(
        Stream.filter(
          (stored) =>
            stored.commandId === CommandId.make(`${rest.commandId}:release`) &&
            stored.event.type === "run.updated",
        ),
        Stream.runHead,
      );
      const settled = yield* launches.launch(rest);
      assert.equal(settled.threadId, first.threadId);
      assert.isTrue(settled.resumed);
      assert.equal(settled.projection.messages[0]?.id, first.projection.messages[0]?.id);
      assert.equal(settled.projection.runs[0]?.id, first.projection.runs[0]?.id);
      assert.equal(harness.runSetup.mock.calls.length, 1);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("replays an accepted launch after the project disables the instance", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const settings = yield* ServerSettings.ServerSettingsService;
    const input = launchInput({
      command: "command:launch:retry-after-disable",
      thread: "thread:launch:retry-after-disable",
      message: "Hello",
    });
    const first = yield* launches.launch(input);

    yield* settings.updateSettings({
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [modelSelection.instanceId]: { enabled: false } } },
      },
    });

    const retry = yield* launches.launch(input);
    assert.equal(retry.threadId, first.threadId);
    assert.isTrue(retry.resumed);

    const fresh = yield* launches
      .launch(
        launchInput({
          command: "command:launch:fresh-after-disable",
          thread: "thread:launch:fresh-after-disable",
          message: "Hello",
        }),
      )
      .pipe(Effect.flip);
    if (fresh._tag !== "ThreadManagementProviderInstanceDisabledError") {
      assert.fail(`expected ThreadManagementProviderInstanceDisabledError, got ${fresh._tag}`);
    }
  }).pipe(Effect.provide(harness.layer));
});

it.effect("an agent's launch never starts work above the modes it asks for", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    // The first launch, at full access, creates the thread without a message.
    const created = yield* launches.launch(
      launchInput({ command: "command:launch:narrowed-retry", thread: "thread:narrowed" }),
    );
    // The same key comes back from a narrower agent, now carrying a message,
    // as a retry or a concurrent launch that lost the create would.
    const failed = yield* launches
      .launch({
        ...launchInput({
          command: "command:launch:narrowed-retry",
          thread: "thread:narrowed",
          message: "Run this",
        }),
        runtimeMode: "approval-required",
        interactionMode: "plan",
        createdBy: "agent",
        creationSource: "mcp",
      })
      .pipe(Effect.flip);
    if (failed._tag !== "ThreadLaunchError") {
      assert.fail(`expected ThreadLaunchError, got ${failed._tag}`);
    }
    assert.equal(failed.operation, "dispatch-message");
    const projection = yield* threads.getThreadProjection(created.threadId);
    assert.equal(projection.runs.length, 0);
    assert.equal(projection.messages.length, 0);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("rejects a server-allocated launch replay with a mismatching thread id", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const { threadId: _unusedThreadId, ...rest } = launchInput({
      command: "command:launch:allocated-mismatch",
      thread: "unused",
      message: "Mismatch",
    });
    const first = yield* launches.launch(rest);
    const failed = yield* launches
      .launch({
        ...rest,
        threadId: ThreadId.make("thread:launch:allocated-mismatch"),
      })
      .pipe(Effect.flip);
    assert.notEqual(first.threadId, ThreadId.make("thread:launch:allocated-mismatch"));
    if (failed._tag !== "ThreadLaunchError") {
      assert.fail(`expected ThreadLaunchError, got ${failed._tag}`);
    }
    assert.equal(failed.operation, "create-thread");
    assert.include(String(failed.cause), "cannot be replayed");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("does not treat an unrelated accepted command receipt as a launch", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const threadId = ThreadId.make("thread:launch:unrelated-receipt");
    yield* threads.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:launch:unrelated-receipt:create"),
      threadId,
      projectId,
      title: "Existing",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    yield* threads.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make("command:launch:unrelated-receipt"),
      threadId,
      expectedEmpty: true,
    });
    const { threadId: _unusedThreadId, ...rest } = launchInput({
      command: "command:launch:unrelated-receipt",
      thread: "unused",
      message: "Should not become a launch",
    });
    const failed = yield* launches.launch(rest).pipe(Effect.flip);
    if (failed._tag !== "ThreadLaunchError") {
      assert.fail(`expected ThreadLaunchError, got ${failed._tag}`);
    }
    assert.equal(failed.operation, "create-thread");
    assert.include(String(failed.cause), "cannot be replayed");
    const projection = yield* threads.getThreadProjection(threadId);
    assert.equal(projection.messages.length, 0);
    assert.equal(projection.runs.length, 0);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("bounds concurrent first launches to one thread per command", () =>
  Effect.gen(function* () {
    const setupEntered = yield* Deferred.make<void>();
    const allowSetup = yield* Deferred.make<void>();
    const harness = makeHarness({
      scratch: true,
      runSetup: () =>
        Deferred.succeed(setupEntered, undefined).pipe(
          Effect.andThen(Deferred.await(allowSetup)),
          Effect.as({ status: "no-script" as const }),
        ),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const { threadId: _unusedThreadId, ...rest } = launchInput({
        command: "command:launch:concurrent-allocated",
        thread: "unused",
        message: "Race me",
        workspace: { type: "root" },
      });
      const results = yield* Effect.all(
        [launches.launch(rest).pipe(Effect.exit), launches.launch(rest).pipe(Effect.exit)],
        { concurrency: "unbounded" },
      );
      const winner = results.find(Exit.isSuccess);
      assert.isDefined(winner);
      const threadId = winner!.value.threadId;
      for (const result of results) {
        if (Exit.isSuccess(result)) {
          assert.equal(result.value.threadId, threadId);
          continue;
        }
        const error = Cause.findErrorOption(result.cause).pipe(Option.getOrThrow);
        if (error._tag !== "ThreadLaunchError") {
          assert.fail(`expected ThreadLaunchError, got ${error._tag}`);
        }
        assert.equal(error.operation, "create-thread");
        assert.include(String(error.cause), "cannot be replayed");
        const retried = yield* launches.launch(rest);
        assert.equal(retried.threadId, threadId);
      }
      const projectThreads = yield* threads.listProjectThreads({
        projectId,
        includeSubagents: false,
      });
      assert.equal(projectThreads.length, 1);
      const projection = yield* threads.getThreadProjection(threadId);
      assert.equal(projection.messages.length, 1);
      assert.equal(projection.runs.length, 1);
      yield* Deferred.await(setupEntered);
      assert.equal(harness.runSetup.mock.calls.length, 1);
      yield* Deferred.succeed(allowSetup, undefined);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("does not let a failing same-command caller strand a concurrent durable launch", () =>
  Effect.gen(function* () {
    const setupEntered = yield* Deferred.make<void>();
    const allowSetup = yield* Deferred.make<void>();
    const harness = makeHarness({
      scratch: true,
      runSetup: () =>
        Deferred.succeed(setupEntered, undefined).pipe(
          Effect.andThen(Deferred.await(allowSetup)),
          Effect.as({ status: "no-script" as const }),
        ),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const command = "command:launch:failed-owner-race";
      const [failed, launched] = yield* Effect.all(
        [
          launches
            .launch({
              ...launchInput({
                command,
                thread: "thread:launch:failed-owner-race",
                message: "This invalid reuse fails",
                workspace: { type: "root" },
              }),
              reuseExistingThread: true,
            })
            .pipe(Effect.exit),
          launches.launch(
            launchInput({
              command,
              thread: "thread:launch:successful-peer",
              message: "This peer persists",
              workspace: { type: "root" },
            }),
          ),
        ],
        { concurrency: "unbounded" },
      );
      assert.isTrue(Exit.isFailure(failed));
      assert.equal(launched.projection.runs[0]?.status, "preparing");
      const entered = yield* Deferred.await(setupEntered).pipe(
        Effect.timeoutOption(Duration.seconds(2)),
      );
      assert.isTrue(Option.isSome(entered));
      assert.equal(harness.runSetup.mock.calls.length, 1);
      yield* Deferred.succeed(allowSetup, undefined);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("reports one concurrent same-command launch as new and the rest as resumed", () =>
  Effect.gen(function* () {
    // Both launches read no receipt before either one claims the thread.
    const arrived = yield* Ref.make(0);
    const bothRead = yield* Deferred.make<void>();
    const harness = makeHarness({
      managedFolders: Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(true),
        folderForThread: () =>
          Ref.updateAndGet(arrived, (count) => count + 1).pipe(
            Effect.tap((count) =>
              count === 2 ? Deferred.succeed(bothRead, undefined) : Effect.void,
            ),
            Effect.andThen(Deferred.await(bothRead)),
            Effect.as(Option.none()),
          ),
      }),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const input = launchInput({
        command: "command:launch:concurrent-resumed",
        thread: "thread:launch:concurrent-resumed",
      });
      const results = yield* Effect.all([launches.launch(input), launches.launch(input)], {
        concurrency: "unbounded",
      });
      assert.deepEqual(results.map((result) => result.resumed).sort(), [false, true]);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect(
  "does not report a retry as resumed when the earlier attempt only claimed the thread",
  () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.gen(function* () {
        const launches = yield* ThreadLaunch.ThreadLaunchService;
        const threads = yield* ThreadManagement.ThreadManagementService;
        const input = launchInput({
          command: "command:launch:claimed-only",
          thread: "thread:launch:claimed-only",
          message: "Counted once",
        });
        yield* threads.dispatch({
          type: "thread.create",
          commandId: input.commandId,
          threadId: input.threadId,
          projectId: input.projectId,
          title: input.title,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          branch: null,
          worktreePath: null,
          createdBy: input.createdBy,
          creationSource: input.creationSource,
        });
        const retried = yield* launches.launch(input);
        assert.isFalse(retried.resumed);
        assert.isTrue((yield* launches.launch(input)).resumed);
      }).pipe(Effect.provide(harness.layer));
    }),
);

it.effect("schedules an accepted preparing root message exactly once", () =>
  Effect.gen(function* () {
    const harness = makeHarness();
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const input = launchInput({
        command: "command:launch:accepted-before-fork",
        thread: "thread:launch:accepted-before-fork",
        message: "Resume preparation",
        workspace: { type: "root" },
      });
      const messageId = MessageId.make("message:launch:accepted-before-fork");

      yield* threads.dispatch({
        type: "thread.create",
        commandId: input.commandId,
        threadId: input.threadId,
        projectId: input.projectId,
        title: input.title,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        branch: null,
        worktreePath: null,
        createdBy: input.createdBy,
        creationSource: input.creationSource,
      });
      yield* threads.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`${input.commandId}:initial-message`),
        threadId: input.threadId,
        messageId,
        text: "Resume preparation",
        attachments: [],
        modelSelection: input.modelSelection,
        dispatchMode: {
          type: "defer_start",
          workspaceStrategy: { type: "root" },
        },
        createdBy: input.createdBy,
        creationSource: input.creationSource,
      });
      const preparing = yield* threads.getThreadProjection(input.threadId);
      assert.equal(preparing.runs[0]?.status, "preparing");

      const [first, second] = yield* Effect.all([launches.launch(input), launches.launch(input)], {
        concurrency: "unbounded",
      });
      assert.isTrue(first.resumed);
      assert.isTrue(second.resumed);
      const projection = yield* preparationSettled(input.threadId);
      assert.equal(projection.runs.length, 1);
      assert.equal(projection.messages.length, 1);
      assert.equal(projection.runs[0]?.status, "starting");
      const effects = yield* (yield* EffectOutbox.EffectOutboxV2).listByCommandId(
        CommandId.make(`${input.commandId}:release`),
      );
      assert.equal(
        effects.filter((effect) => effect.request.type === "provider-turn.start").length,
        1,
      );
      assert.equal(harness.runSetup.mock.calls.length, 0);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("prepares a launch whose caller goes away after its first message commits", () =>
  Effect.gen(function* () {
    const messageCommitted = yield* Deferred.make<void>();
    const finishDispatch = yield* Deferred.make<void>();
    const setupEntered = yield* Deferred.make<void>();
    const harness = makeHarness({
      scratch: true,
      runSetup: () =>
        Deferred.succeed(setupEntered, undefined).pipe(Effect.as({ status: "no-script" as const })),
      dispatch: (command, dispatch) =>
        dispatch(command).pipe(
          Effect.tap((result) =>
            result.storedEvents.some((stored) => stored.event.type === "run.created")
              ? Deferred.succeed(messageCommitted, undefined).pipe(
                  Effect.andThen(Deferred.await(finishDispatch)),
                )
              : Effect.void,
          ),
        ),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const launch = yield* Effect.forkChild(
        launches.launch(
          launchInput({
            command: "command:launch:caller-gone",
            thread: "thread:launch:caller-gone",
            message: "Prepare without the caller",
            workspace: { type: "root" },
          }),
        ),
      );
      yield* Deferred.await(messageCommitted);
      yield* Effect.sync(() => launch.interruptUnsafe());
      yield* Deferred.succeed(finishDispatch, undefined);
      yield* Fiber.await(launch);
      yield* Deferred.await(setupEntered);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("creates a strong provider-thread mapping for an imported native session", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const input = {
      ...launchInput({
        command: "command:launch:imported-native-session",
        thread: "thread:launch:imported-native-session",
      }),
      importedNativeThread: {
        ref: {
          driver: ProviderDriverKind.make("codex"),
          nativeId: "native-session-42",
          strength: "strong" as const,
        },
        metadata: {
          title: "Native session",
          updatedAt: "2026-08-23T00:00:00Z",
        },
      },
    };

    const launched = yield* launches.launch(input);

    assert.deepInclude(launched.projection.providerThreads[0], {
      id: IdAllocator.deriveProviderThread({
        driver: input.importedNativeThread.ref.driver,
        providerInstanceId: modelSelection.instanceId,
        nativeThreadId: input.importedNativeThread.ref.nativeId,
      }),
      driver: input.importedNativeThread.ref.driver,
      providerInstanceId: modelSelection.instanceId,
      appThreadId: input.threadId,
      nativeThreadRef: input.importedNativeThread.ref,
      status: "not_loaded",
      nativeMetadata: input.importedNativeThread.metadata,
    });
    assert.equal(
      launched.projection.thread.activeProviderThreadId,
      launched.projection.providerThreads[0]?.id,
    );
  }).pipe(Effect.provide(harness.layer));
});

it.effect("shared intake preserves durable attachment bytes after a lost launch result", () => {
  const harness = makeHarness();
  const layerFiles = ServerConfig.layerTest(process.cwd(), { prefix: "t3-message-intake-" }).pipe(
    Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  );
  return Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const pendingId = createPendingAttachmentId();
    assert.isNotNull(pendingId);
    const attachment: ChatAttachment = {
      type: "image",
      id: ChatAttachmentId.make(pendingId),
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 4,
    };
    const pendingPath = resolveAttachmentPath({
      attachmentsDir: config.attachmentsDir,
      attachment,
    });
    assert.isNotNull(pendingPath);
    yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
    yield* fs.writeFile(pendingPath, new Uint8Array([1, 2, 3, 4]));
    const input = {
      ...launchInput({ command: "intake-launch", thread: "intake-thread" }),
      initialMessage: {
        messageId: MessageId.make("intake-first"),
        text: "First [file](t3-context://v1/file/intake-file)",
        context: {
          version: 1 as const,
          records: [
            {
              version: 1 as const,
              contextId: ComposerContextId.make("intake-file"),
              kind: "file" as const,
              label: attachment.name,
              attachmentId: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            },
          ],
        },
        attachments: [attachment],
      },
    };
    const failed = yield* ThreadMessageIntake.launchThread(input).pipe(
      Effect.provideService(ThreadLaunch.ThreadLaunchService, {
        launch: (request) =>
          launches.launch(request).pipe(
            Effect.andThen(
              new ThreadLaunch.ThreadLaunchError({
                operation: "create-thread",
                commandId: request.commandId,
                projectId,
                cause: "lost result after acceptance",
              }),
            ),
          ),
        checkWorktreeBase: launches.checkWorktreeBase,
        isNonGitProject: launches.isNonGitProject,
        retryPreparation: launches.retryPreparation,
        prepareRun: launches.prepareRun,
      }),
      Effect.flip,
    );
    assert.equal(failed._tag, "ThreadLaunchError");
    const accepted = yield* threads.getThreadProjection(input.threadId);
    const stored = accepted.messages.find(
      (message) => message.id === input.initialMessage.messageId,
    );
    assert.isDefined(stored);
    assert.notEqual(stored.attachments[0]?.id, attachment.id);
    const record = stored.context?.records[0];
    assert.isDefined(record);
    assert.equal((record as { attachmentId: string }).attachmentId, stored.attachments[0]?.id);
    const userItem = accepted.turnItems.find(
      (item) => item.type === "user_message" && item.messageId === stored.id,
    );
    assert.ok(userItem?.type === "user_message");
    assert.deepEqual(userItem.context, stored.context);
    const storedPath = resolveAttachmentPath({
      attachmentsDir: config.attachmentsDir,
      attachment: stored.attachments[0]!,
    });
    assert.isNotNull(storedPath);
    assert.deepEqual(yield* fs.readFile(storedPath), new Uint8Array([1, 2, 3, 4]));
    assert.deepEqual(yield* fs.readFile(pendingPath), new Uint8Array([1, 2, 3, 4]));

    const replayed = yield* ThreadMessageIntake.launchThread(input);
    assert.equal(replayed.projection.messages[0]?.id, stored.id);
    assert.deepEqual(replayed.projection.messages[0]?.attachments, stored.attachments);
    const claimedFiles = Effect.map(fs.readDirectory(config.attachmentsDir), (files) =>
      files.filter((name) => !name.startsWith("pending-")),
    );
    assert.equal((yield* claimedFiles).length, 1);

    const duplicate = yield* ThreadMessageIntake.launchThread({
      ...input,
      commandId: CommandId.make("intake-duplicate-create"),
      initialMessage: { ...input.initialMessage, messageId: MessageId.make("intake-duplicate") },
    }).pipe(Effect.result);
    assert.ok(Result.isFailure(duplicate));
    assert.ok(duplicate.failure._tag === "ThreadLaunchError");
    assert.equal(duplicate.failure.operation, "create-thread");
    assert.propertyVal(duplicate.failure.cause, "_tag", "OrchestratorThreadAlreadyExistsError");
    assert.equal((yield* claimedFiles).length, 1);
    assert.deepEqual(yield* fs.readFile(storedPath), new Uint8Array([1, 2, 3, 4]));
    assert.deepEqual(yield* fs.readFile(pendingPath), new Uint8Array([1, 2, 3, 4]));

    const missingProject = yield* ThreadMessageIntake.launchThread({
      ...input,
      commandId: CommandId.make("intake-no-project"),
      projectId: ProjectId.make("missing-project"),
    }).pipe(Effect.flip);
    assert.equal(missingProject._tag, "ThreadLaunchError");
    assert.equal((yield* claimedFiles).length, 1);
    const missingThread = yield* dispatchIntakeCommand({
      type: "message.dispatch",
      commandId: CommandId.make("intake-no-thread"),
      threadId: ThreadId.make("missing-thread"),
      messageId: MessageId.make("intake-missing"),
      text: "Missing",
      attachments: [attachment],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    }).pipe(Effect.flip);
    assert.equal(missingThread._tag, "OrchestratorProjectionError");
    assert.equal((yield* claimedFiles).length, 1);

    const dispatch = dispatchIntakeCommand({
      type: "message.dispatch",
      commandId: CommandId.make("intake-dispatch"),
      threadId: input.threadId,
      messageId: MessageId.make("intake-second"),
      text: "Second",
      attachments: [attachment],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* dispatch;
    yield* dispatch;
    const queuedProjection = yield* threads.getThreadProjection(input.threadId);
    const queuedRun = queuedProjection.runs.find(
      (run) => run.userMessageId === MessageId.make("intake-second"),
    );
    assert.isDefined(queuedRun);
    assert.equal(queuedRun.status, "queued");
    const queuedMessage = queuedProjection.messages.find(
      (message) => message.id === queuedRun.userMessageId,
    );
    assert.isDefined(queuedMessage);
    const file: ChatAttachment = {
      type: "file",
      id: ChatAttachmentId.make(createPendingAttachmentId("pdf")),
      name: "queued.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    };
    const filePath = resolveAttachmentPath({
      attachmentsDir: config.attachmentsDir,
      attachment: file,
    });
    assert.isNotNull(filePath);
    yield* fs.writeFile(filePath, new Uint8Array([5, 6, 7, 8]));
    const edit = dispatchIntakeCommand({
      type: "queued-run.edit",
      commandId: CommandId.make("intake-edit"),
      threadId: input.threadId,
      runId: queuedRun.id,
      text: "Edited with a file",
      attachments: [...queuedMessage.attachments, file],
    });
    yield* edit;
    yield* edit;
    const editedProjection = yield* threads.getThreadProjection(input.threadId);
    const editedMessage = editedProjection.messages.find(
      (message) => message.id === queuedRun.userMessageId,
    );
    assert.isDefined(editedMessage);
    assert.equal(editedMessage.attachments.length, 2);
    assert.deepEqual(editedMessage.attachments[0], queuedMessage.attachments[0]);
    assert.notEqual(editedMessage.attachments[1]?.id, file.id);
    const durableFilePath = resolveAttachmentPath({
      attachmentsDir: config.attachmentsDir,
      attachment: editedMessage.attachments[1]!,
    });
    assert.isNotNull(durableFilePath);
    assert.deepEqual(yield* fs.readFile(durableFilePath), new Uint8Array([5, 6, 7, 8]));
    assert.deepEqual(yield* fs.readFile(filePath), new Uint8Array([5, 6, 7, 8]));
    const beforeRejectedEdit = (yield* claimedFiles).length;
    const rejectedEdit = yield* dispatchIntakeCommand({
      type: "queued-run.edit",
      commandId: CommandId.make("intake-edit-rejected"),
      threadId: input.threadId,
      runId: queuedRun.id,
      text: "",
      attachments: [file],
    }).pipe(Effect.flip);
    assert.equal(rejectedEdit._tag, "OrchestratorCommandRejectedError");
    assert.equal((yield* claimedFiles).length, beforeRejectedEdit);
    assert.deepEqual(yield* fs.readFile(filePath), new Uint8Array([5, 6, 7, 8]));
    const send = ThreadMessageIntake.sendToThread({
      commandId: CommandId.make("intake-send"),
      projectId,
      threadId: input.threadId,
      messageId: MessageId.make("intake-third"),
      text: "Third",
      attachments: [attachment],
      mode: "queue",
      createdBy: "agent",
      creationSource: "mcp",
    });
    yield* send;
    yield* send;
    assert.equal((yield* claimedFiles).length, 4);
    const final = yield* threads.getThreadProjection(input.threadId);
    assert.equal(final.messages.length, 3);
    for (const message of final.messages) {
      const path = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment: message.attachments[0]!,
      });
      assert.isNotNull(path);
      assert.deepEqual(yield* fs.readFile(path), new Uint8Array([1, 2, 3, 4]));
    }
  }).pipe(Effect.provide(Layer.mergeAll(harness.layer, layerFiles)));
});

it.effect.each([0, 1])("releases a Scratch async setup without waiting for exit %s", (exitCode) =>
  Effect.gen(function* () {
    const completion = yield* Deferred.make<{ exitCode: number | null; durationMs: number }>();
    const harness = makeHarness({
      scratch: true,
      runSetup: () =>
        Effect.succeed({
          status: "started" as const,
          async: true,
          scriptId: "setup",
          scriptName: "Setup",
          scriptCommand: "prepare",
          terminalId: "setup",
          cwd: "/scratch/async",
          completion: Deferred.await(completion),
        }),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const launched = yield* launches.launch(
        launchInput({
          command: `command:launch:async-${exitCode}`,
          thread: `thread:launch:async-${exitCode}`,
          message: "Start during setup",
        }),
      );
      const projection = yield* preparationSettled(launched.threadId);
      assert.equal(projection.runs[0]?.status, "starting");
      assert.equal(harness.closeTerminal.mock.calls.length, 0);
      yield* Deferred.succeed(completion, { exitCode, durationMs: 1 });
      const threads = yield* ThreadManagement.ThreadManagementService;
      assert.equal(
        (yield* threads.getThreadProjection(launched.threadId)).runs[0]?.status,
        "starting",
      );
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("interrupts Scratch setup and closes its terminal before releasing provider work", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const closed = yield* Deferred.make<void>();
    const harness = makeHarness({
      scratch: true,
      closeTerminal: () => Deferred.succeed(closed, undefined).pipe(Effect.asVoid),
      runSetup: () =>
        Effect.succeed({
          status: "started" as const,
          async: false,
          scriptId: "setup",
          scriptName: "Setup",
          scriptCommand: "prepare",
          terminalId: "setup-terminal",
          cwd: "/scratch/cancel",
          completion: Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
        }),
    });
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const launched = yield* launches.launch(
        launchInput({
          command: "launch:cancel-scratch",
          thread: "thread:cancel-scratch",
          message: "Start",
        }),
      );
      yield* Deferred.await(entered);
      yield* threads.dispatch({
        type: "run.interrupt",
        commandId: CommandId.make("launch:cancel-scratch:interrupt"),
        threadId: launched.threadId,
        runId: launched.projection.runs[0]!.id,
      });
      yield* Deferred.await(interrupted);
      yield* Deferred.await(closed);
      const projection = yield* threads.getThreadProjection(launched.threadId);
      assert.equal(projection.runs[0]?.status, "interrupted");
      assert.equal(projection.thread.worktreePath, "/scratch/thread:cancel-scratch");
      assert.deepEqual(harness.closeTerminal.mock.calls[0]?.[0], {
        threadId: launched.threadId,
        terminalId: "setup-terminal",
        deleteHistory: true,
      });
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      assert.isEmpty(
        yield* outbox.listByCommandId(CommandId.make("launch:cancel-scratch:release")),
      );
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("replays an accepted send after the project disables the instance", () => {
  const harness = makeHarness();
  const layerFiles = ServerConfig.layerTest(process.cwd(), { prefix: "t3-send-retry-" }).pipe(
    Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  );
  return Effect.gen(function* () {
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const settings = yield* ServerSettings.ServerSettingsService;
    const created = yield* launches.launch(
      launchInput({
        command: "command:send:retry-setup",
        thread: "thread:send:retry-after-disable",
      }),
    );

    const sendInput = {
      commandId: CommandId.make("command:send:retry-after-disable"),
      projectId,
      threadId: created.threadId,
      messageId: MessageId.make("message:send:retry-after-disable"),
      text: "Hello again",
      attachments: [],
      mode: "auto" as const,
      createdBy: "user" as const,
      creationSource: "web" as const,
    };
    const first = yield* ThreadMessageIntake.sendToThread(sendInput);

    yield* settings.updateSettings({
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [modelSelection.instanceId]: { enabled: false } } },
      },
    });

    const retry = yield* ThreadMessageIntake.sendToThread(sendInput);
    assert.equal(retry.message.id, first.message.id);

    const fresh = yield* ThreadMessageIntake.sendToThread({
      ...sendInput,
      commandId: CommandId.make("command:send:fresh-after-disable"),
      messageId: MessageId.make("message:send:fresh-after-disable"),
    }).pipe(Effect.flip);
    if (fresh._tag !== "ThreadManagementProviderInstanceDisabledError") {
      assert.fail(`expected ThreadManagementProviderInstanceDisabledError, got ${fresh._tag}`);
    }
  }).pipe(Effect.provide(Layer.mergeAll(harness.layer, layerFiles)));
});
