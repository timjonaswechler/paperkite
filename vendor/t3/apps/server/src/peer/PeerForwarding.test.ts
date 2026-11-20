import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import * as PeerForwarding from "./PeerForwarding.ts";

const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("local"),
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  requestNamespace: "single-server-test",
  thread: undefined,
  client: undefined,
  linkedEnvironments: true,
};

it.effect(
  "rejects remote reads, waits and discovery without acquiring peer transports or credentials",
  () =>
    Effect.gen(function* () {
      const service = yield* PeerForwarding.PeerForwarding;
      const remote = EnvironmentId.make("old-saved-remote");
      const input = { threadId: ThreadId.make("remote-thread") };
      expect((yield* service.readThread(scope, remote, input).pipe(Effect.flip)).code).toBe(
        "capability_denied",
      );
      expect((yield* service.waitForThread(scope, remote, input).pipe(Effect.flip)).code).toBe(
        "capability_denied",
      );
      expect((yield* service.interruptThread(scope, remote, input).pipe(Effect.flip)).code).toBe(
        "capability_denied",
      );
      expect((yield* service.links(scope).pipe(Effect.flip)).code).toBe("capability_denied");
      expect(PeerForwarding.remoteTarget(scope, scope.environmentId)).toBeUndefined();
      expect(PeerForwarding.remoteTarget(scope, remote)).toBe(remote);
    }).pipe(Effect.provide(PeerForwarding.layer)),
);
