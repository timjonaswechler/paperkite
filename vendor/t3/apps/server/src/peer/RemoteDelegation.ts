import {
  type EnvironmentId,
  type NodeId,
  type OrchestratorMcpDelegateTaskInput,
  type OrchestratorMcpTaskCancelResult,
  type OrchestratorMcpThreadRun,
  type OrchestratorMcpThreadSendInput,
  type OrchestratorMcpThreadSendResult,
  type OrchestrationV2Subagent,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { linkedEnvironmentsOff } from "./PeerForwarding.ts";

type ThreadScope = McpInvocationContext.McpThreadInvocationScope;

export class RemoteDelegation extends Context.Service<
  RemoteDelegation,
  {
    readonly delegate: (
      scope: ThreadScope,
      input: OrchestratorMcpDelegateTaskInput & {
        readonly target: NonNullable<OrchestratorMcpDelegateTaskInput["target"]> & {
          readonly environmentId: EnvironmentId;
        };
      },
    ) => Effect.Effect<{ readonly taskId: NodeId }, OrchestratorMcpFailure>;
    readonly followUp: (
      scope: McpInvocationContext.McpInvocationScope,
      environmentId: EnvironmentId,
      request: Pick<OrchestratorMcpThreadSendInput, "message" | "clientRequestId">,
      sent: OrchestratorMcpThreadSendResult,
    ) => Effect.Effect<OrchestratorMcpThreadSendResult, OrchestratorMcpFailure>;
    readonly cancel: (
      scope: ThreadScope,
      task: OrchestrationV2Subagent,
      input: {
        readonly reason?: string | undefined;
        readonly clientRequestId?: string | undefined;
      },
    ) => Effect.Effect<OrchestratorMcpTaskCancelResult, OrchestratorMcpFailure>;
    readonly runStatus: (
      scope: ThreadScope,
      task: OrchestrationV2Subagent,
    ) => Effect.Effect<OrchestratorMcpThreadRun["status"] | null>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/peer/RemoteDelegation") {}

const unavailable = () => Effect.fail(linkedEnvironmentsOff);

export const layer = Layer.succeed(
  RemoteDelegation,
  RemoteDelegation.of({
    delegate: unavailable,
    followUp: unavailable,
    cancel: unavailable,
    runStatus: Effect.fn("RemoteDelegation.runStatus")(() => Effect.succeed(null)),
    start: Effect.fn("RemoteDelegation.start")(() => Effect.void),
  }),
);
