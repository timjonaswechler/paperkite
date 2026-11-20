import {
  type EnvironmentId,
  OrchestratorMcpFailure,
  type OrchestratorMcpEnvironmentLinksResult,
  type OrchestratorMcpThreadInterruptInput,
  type OrchestratorMcpThreadInterruptResult,
  type OrchestratorMcpThreadReadInput,
  type OrchestratorMcpThreadReadResult,
  type OrchestratorMcpThreadWaitInput,
  type OrchestratorMcpThreadWaitResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Tool from "effect/ai/Tool";
import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";

type Scope = McpInvocationContext.McpInvocationScope;

export class PeerForwarding extends Context.Service<
  PeerForwarding,
  {
    readonly call: <T extends Tool.Any>(
      scope: Scope,
      tool: T,
      environmentId: EnvironmentId,
      params: Tool.Parameters<T>,
    ) => Effect.Effect<Tool.Success<T>, OrchestratorMcpFailure>;
    readonly readThread: (
      scope: Scope,
      environmentId: EnvironmentId,
      input: OrchestratorMcpThreadReadInput,
    ) => Effect.Effect<OrchestratorMcpThreadReadResult, OrchestratorMcpFailure>;
    readonly interruptThread: (
      scope: Scope,
      environmentId: EnvironmentId,
      input: OrchestratorMcpThreadInterruptInput,
    ) => Effect.Effect<OrchestratorMcpThreadInterruptResult, OrchestratorMcpFailure>;
    readonly waitForThread: (
      scope: Scope,
      environmentId: EnvironmentId,
      input: OrchestratorMcpThreadWaitInput,
    ) => Effect.Effect<OrchestratorMcpThreadWaitResult, OrchestratorMcpFailure>;
    readonly links: (
      scope: Scope,
    ) => Effect.Effect<OrchestratorMcpEnvironmentLinksResult, OrchestratorMcpFailure>;
  }
>()("t3/peer/PeerForwarding") {}

export const linkedEnvironmentsOff = new OrchestratorMcpFailure({
  code: "capability_denied",
  message: "Bewerbungen uses only this web server. Remote environments are not supported.",
});

export const remoteTarget = (scope: Scope, environmentId: EnvironmentId | undefined) =>
  environmentId === scope.environmentId ? undefined : environmentId;

const unavailable = () => Effect.fail(linkedEnvironmentsOff);

// Keep local MCP callers on the native interface without loading any peer transport or credentials.
export const layer = Layer.succeed(
  PeerForwarding,
  PeerForwarding.of({
    call: unavailable,
    readThread: unavailable,
    interruptThread: unavailable,
    waitForThread: unavailable,
    links: unavailable,
  }),
);
